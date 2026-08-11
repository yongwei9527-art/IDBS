package com.laboratory.managementsystem;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.Arrays;

import org.junit.Test;

public class TrustedServerConfigurationTest {
    private static final String INSTANCE_ID = "instance_12345678";
    private static final String FINGERPRINT = repeat('a', 64);
    private static final String CONFIRMED_AT = "2026-08-10T12:34:56.789Z";

    @Test
    public void create_normalizesAndRetainsCompleteConfiguration() {
        TrustedServerConfiguration configuration = configuration(
            "https://EXAMPLE.com:443/", "Laboratory", "Primary instance", INSTANCE_ID,
            repeat('A', 64), CONFIRMED_AT
        );

        assertEquals("https://example.com", configuration.getServerUrl());
        assertEquals("Laboratory", configuration.getOrganizationName());
        assertEquals("Primary instance", configuration.getInstanceName());
        assertEquals(INSTANCE_ID, configuration.getInstanceId());
        assertEquals(FINGERPRINT, configuration.getFingerprint());
        assertEquals(CONFIRMED_AT, configuration.getConfirmedAt());
    }

    @Test
    public void encodeDecode_roundTripsOneVersionedPayload() throws Exception {
        TrustedServerConfiguration original = defaultConfiguration();
        byte[] payload = original.encode();
        TrustedServerConfiguration decoded = TrustedServerConfiguration.decode(payload);

        assertArrayEquals(new byte[] { 'L', 'S', 'C', 'F', 2 }, Arrays.copyOf(payload, 5));
        assertEquals(original.getServerUrl(), decoded.getServerUrl());
        assertEquals(original.getOrganizationName(), decoded.getOrganizationName());
        assertEquals(original.getInstanceName(), decoded.getInstanceName());
        assertEquals(original.getInstanceId(), decoded.getInstanceId());
        assertEquals(original.getFingerprint(), decoded.getFingerprint());
        assertEquals(original.getConfirmedAt(), decoded.getConfirmedAt());
    }

    @Test
    public void decode_rejectsWrongVersionTruncationAndTrailingData() throws Exception {
        byte[] payload = defaultConfiguration().encode();

        byte[] wrongVersion = payload.clone();
        wrongVersion[4] = 3;
        assertThrows(IOException.class, () -> TrustedServerConfiguration.decode(wrongVersion));
        assertThrows(IOException.class, () -> TrustedServerConfiguration.decode(Arrays.copyOf(payload, payload.length - 1)));

        byte[] trailing = Arrays.copyOf(payload, payload.length + 1);
        trailing[trailing.length - 1] = 1;
        assertThrows(IOException.class, () -> TrustedServerConfiguration.decode(trailing));
    }

    @Test
    public void create_rejectsUnsafeLabels() {
        String[] unsafeLabels = {
            null,
            "",
            " leading",
            "trailing ",
            "line\nbreak",
            "control\u0085character",
            "bidi\u202Eoverride",
            "isolate\u2066text",
            repeat('x', 161)
        };

        for (String label : unsafeLabels) {
            assertThrows(
                String.valueOf(label),
                IllegalArgumentException.class,
                () -> configuration("https://example.com", label, "Instance", INSTANCE_ID, FINGERPRINT, CONFIRMED_AT)
            );
            assertThrows(
                String.valueOf(label),
                IllegalArgumentException.class,
                () -> configuration("https://example.com", "Organization", label, INSTANCE_ID, FINGERPRINT, CONFIRMED_AT)
            );
        }
    }

    @Test
    public void create_rejectsInvalidInstanceFingerprintAndTimestamp() {
        String[] invalidInstanceIds = { null, "short", "_invalid-start", "contains space", repeat('x', 129) };
        for (String instanceId : invalidInstanceIds) {
            assertThrows(IllegalArgumentException.class, () -> configuration(
                "https://example.com", "Organization", "Instance", instanceId, FINGERPRINT, CONFIRMED_AT
            ));
        }

        String[] invalidFingerprints = { null, repeat('a', 63), repeat('a', 65), repeat('g', 64), repeat(' ', 64) };
        for (String fingerprint : invalidFingerprints) {
            assertThrows(IllegalArgumentException.class, () -> configuration(
                "https://example.com", "Organization", "Instance", INSTANCE_ID, fingerprint, CONFIRMED_AT
            ));
        }

        String[] invalidTimestamps = {
            null,
            "",
            "2026-08-10T12:34:56Z",
            "2026-08-10T12:34:56.789+00:00",
            "2026-02-30T12:34:56.789Z",
            "2026-08-10t12:34:56.789z",
            "2026-08-10T12:34:56.789Z "
        };
        for (String timestamp : invalidTimestamps) {
            assertThrows(IllegalArgumentException.class, () -> configuration(
                "https://example.com", "Organization", "Instance", INSTANCE_ID, FINGERPRINT, timestamp
            ));
        }
    }

    @Test
    public void securityIdentity_ignoresDisplayNameChanges() {
        TrustedServerConfiguration original = defaultConfiguration();
        TrustedServerConfiguration renamed = configuration(
            "https://example.com", "Renamed organization", "Renamed instance",
            INSTANCE_ID, FINGERPRINT, "2026-08-10T12:35:00.000Z"
        );

        assertTrue(original.hasSameSecurityIdentity(renamed));
    }

    @Test
    public void securityIdentity_detectsServerInstanceAndFingerprintChanges() {
        TrustedServerConfiguration original = defaultConfiguration();
        assertFalse(original.hasSameSecurityIdentity(configuration(
            "https://other.example.com", "Organization", "Instance", INSTANCE_ID, FINGERPRINT, CONFIRMED_AT
        )));
        assertFalse(original.hasSameSecurityIdentity(configuration(
            "https://example.com", "Organization", "Instance", "instance_87654321", FINGERPRINT, CONFIRMED_AT
        )));
        assertFalse(original.hasSameSecurityIdentity(configuration(
            "https://example.com", "Organization", "Instance", INSTANCE_ID, repeat('b', 64), CONFIRMED_AT
        )));
    }

    @Test
    public void replacementPolicy_blocksSameOriginIdentityChangesAndRequiresApprovalForCrossOrigin() {
        TrustedServerConfiguration original = defaultConfiguration();
        TrustedServerConfiguration renamed = configuration(
            "https://example.com", "Renamed organization", "Renamed instance",
            INSTANCE_ID, FINGERPRINT, "2026-08-10T12:35:00.000Z"
        );
        TrustedServerConfiguration changedFingerprint = configuration(
            "https://example.com", "Organization", "Instance",
            INSTANCE_ID, repeat('b', 64), CONFIRMED_AT
        );
        TrustedServerConfiguration otherServer = configuration(
            "https://other.example.com", "Organization", "Instance",
            "instance_87654321", repeat('b', 64), CONFIRMED_AT
        );

        assertTrue(TrustedServerConfiguration.mayReplaceTrustedIdentity(null, original, false));
        assertTrue(TrustedServerConfiguration.mayReplaceTrustedIdentity(original, renamed, false));
        assertFalse(TrustedServerConfiguration.mayReplaceTrustedIdentity(original, changedFingerprint, false));
        assertFalse(TrustedServerConfiguration.mayReplaceTrustedIdentity(original, changedFingerprint, true));
        assertFalse(TrustedServerConfiguration.mayReplaceTrustedIdentity(original, otherServer, false));
        assertTrue(TrustedServerConfiguration.mayReplaceTrustedIdentity(original, otherServer, true));
    }

    @Test
    public void replacementPolicy_allowsMetadataRefreshWithoutServerSwitchApproval() {
        TrustedServerConfiguration original = defaultConfiguration();
        TrustedServerConfiguration refreshed = configuration(
            "https://example.com", "New organization label", "New instance label",
            INSTANCE_ID, FINGERPRINT, "2026-08-11T00:00:00.000Z"
        );

        assertTrue(TrustedServerConfiguration.mayReplaceTrustedIdentity(original, refreshed, false));
        assertEquals("New organization label", refreshed.getOrganizationName());
        assertEquals("New instance label", refreshed.getInstanceName());
    }

    @Test
    public void installationId_matchesWebContractAndIsRandom() {
        String first = TrustedServerConfiguration.generateInstallationId();
        String second = TrustedServerConfiguration.generateInstallationId();

        assertTrue(TrustedServerConfiguration.isValidInstallationId(first));
        assertTrue(TrustedServerConfiguration.isValidInstallationId(second));
        assertNotEquals(first, second);
        assertFalse(TrustedServerConfiguration.isValidInstallationId(null));
        assertFalse(TrustedServerConfiguration.isValidInstallationId("too-short"));
        assertFalse(TrustedServerConfiguration.isValidInstallationId("invalid installation id"));
        assertFalse(TrustedServerConfiguration.isValidInstallationId(repeat('x', 129)));
    }

    private static TrustedServerConfiguration defaultConfiguration() {
        return configuration(
            "https://example.com", "Organization", "Instance", INSTANCE_ID, FINGERPRINT, CONFIRMED_AT
        );
    }

    private static TrustedServerConfiguration configuration(
        String serverUrl,
        String organizationName,
        String instanceName,
        String instanceId,
        String fingerprint,
        String confirmedAt
    ) {
        return TrustedServerConfiguration.create(
            serverUrl, organizationName, instanceName, instanceId, fingerprint, confirmedAt
        );
    }

    private static String repeat(char value, int count) {
        char[] characters = new char[count];
        Arrays.fill(characters, value);
        return new String(characters);
    }
}
