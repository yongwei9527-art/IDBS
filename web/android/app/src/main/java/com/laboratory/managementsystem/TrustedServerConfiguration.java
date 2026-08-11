package com.laboratory.managementsystem;

import androidx.annotation.Nullable;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.net.URI;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Immutable, validated payload for a trusted server identity.
 *
 * The binary representation is versioned and is encrypted as one AES-GCM plaintext by
 * {@link NativeRuntimePlugin}. Keeping the validation and serialization Android-independent
 * also makes the trust boundary directly unit testable on the JVM.
 */
final class TrustedServerConfiguration {
    static final int PAYLOAD_VERSION = 2;

    private static final int MAX_SERVER_URL_LENGTH = 2048;
    private static final int MAX_LABEL_LENGTH = 160;
    private static final int MAX_CONFIRMED_AT_LENGTH = 64;
    private static final byte[] PAYLOAD_MAGIC = new byte[] { 'L', 'S', 'C', 'F' };
    private static final Pattern INSTANCE_ID_PATTERN = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$");
    private static final Pattern FINGERPRINT_PATTERN = Pattern.compile("^[a-f0-9]{64}$");
    private static final Pattern INSTALLATION_ID_PATTERN = Pattern.compile("^[A-Za-z0-9._:-]{16,128}$");

    private final String serverUrl;
    private final String organizationName;
    private final String instanceName;
    private final String instanceId;
    private final String fingerprint;
    private final String confirmedAt;

    private TrustedServerConfiguration(
        String serverUrl,
        String organizationName,
        String instanceName,
        String instanceId,
        String fingerprint,
        String confirmedAt
    ) {
        this.serverUrl = serverUrl;
        this.organizationName = organizationName;
        this.instanceName = instanceName;
        this.instanceId = instanceId;
        this.fingerprint = fingerprint;
        this.confirmedAt = confirmedAt;
    }

    static TrustedServerConfiguration create(
        @Nullable String serverUrl,
        @Nullable String organizationName,
        @Nullable String instanceName,
        @Nullable String instanceId,
        @Nullable String fingerprint,
        @Nullable String confirmedAt
    ) {
        String normalizedServerUrl = normalizeHttpsServerUrl(serverUrl);
        if (normalizedServerUrl == null) {
            throw new IllegalArgumentException("Invalid serverUrl.");
        }
        String normalizedOrganizationName = requireSafeLabel(organizationName, "organizationName");
        String normalizedInstanceName = requireSafeLabel(instanceName, "instanceName");
        if (instanceId == null || !INSTANCE_ID_PATTERN.matcher(instanceId).matches()) {
            throw new IllegalArgumentException("Invalid instanceId.");
        }
        String normalizedFingerprint = fingerprint == null ? null : fingerprint.toLowerCase(Locale.ROOT);
        if (normalizedFingerprint == null || !FINGERPRINT_PATTERN.matcher(normalizedFingerprint).matches()) {
            throw new IllegalArgumentException("Invalid fingerprint.");
        }
        String normalizedConfirmedAt = normalizeConfirmedAt(confirmedAt);
        if (normalizedConfirmedAt == null) {
            throw new IllegalArgumentException("Invalid confirmedAt.");
        }
        return new TrustedServerConfiguration(
            normalizedServerUrl,
            normalizedOrganizationName,
            normalizedInstanceName,
            instanceId,
            normalizedFingerprint,
            normalizedConfirmedAt
        );
    }

    static TrustedServerConfiguration decode(byte[] payload) throws IOException {
        if (payload == null) {
            throw new IOException("Missing trusted server payload.");
        }
        try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(payload))) {
            for (byte expected : PAYLOAD_MAGIC) {
                if (input.readByte() != expected) {
                    throw new IOException("Invalid trusted server payload magic.");
                }
            }
            int version = input.readUnsignedByte();
            if (version != PAYLOAD_VERSION) {
                throw new IOException("Unsupported trusted server payload version.");
            }
            TrustedServerConfiguration configuration = create(
                input.readUTF(), input.readUTF(), input.readUTF(), input.readUTF(), input.readUTF(), input.readUTF()
            );
            if (input.read() != -1) {
                throw new IOException("Unexpected trailing trusted server payload data.");
            }
            return configuration;
        } catch (EOFException | IllegalArgumentException exception) {
            throw new IOException("Invalid trusted server payload.", exception);
        }
    }

    byte[] encode() throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (DataOutputStream data = new DataOutputStream(output)) {
            data.write(PAYLOAD_MAGIC);
            data.writeByte(PAYLOAD_VERSION);
            data.writeUTF(serverUrl);
            data.writeUTF(organizationName);
            data.writeUTF(instanceName);
            data.writeUTF(instanceId);
            data.writeUTF(fingerprint);
            data.writeUTF(confirmedAt);
        }
        return output.toByteArray();
    }

    boolean hasSameSecurityIdentity(TrustedServerConfiguration other) {
        return other != null
            && serverUrl.equals(other.serverUrl)
            && instanceId.equals(other.instanceId)
            && fingerprint.equals(other.fingerprint);
    }

    static boolean mayReplaceTrustedIdentity(
        @Nullable TrustedServerConfiguration existing,
        TrustedServerConfiguration candidate,
        boolean allowServerSwitch
    ) {
        if (existing == null || existing.hasSameSecurityIdentity(candidate)) {
            return true;
        }
        // A different identity on the same HTTPS origin is a possible server takeover and
        // must never be accepted as a routine server switch. Explicit replacement is only
        // valid when the user is moving to a different origin.
        return !existing.serverUrl.equals(candidate.serverUrl) && allowServerSwitch;
    }

    String getServerUrl() { return serverUrl; }
    String getOrganizationName() { return organizationName; }
    String getInstanceName() { return instanceName; }
    String getInstanceId() { return instanceId; }
    String getFingerprint() { return fingerprint; }
    String getConfirmedAt() { return confirmedAt; }

    @Nullable
    static String normalizeHttpsServerUrl(@Nullable String candidate) {
        if (candidate == null || candidate.length() > MAX_SERVER_URL_LENGTH) {
            return null;
        }
        try {
            String trimmed = candidate.trim();
            if (trimmed.isEmpty() || !candidate.equals(trimmed)) {
                return null;
            }
            URI uri = new URI(trimmed);
            String host = uri.getHost();
            if (uri.isOpaque() || !"https".equalsIgnoreCase(uri.getScheme()) || host == null || host.isEmpty()
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                return null;
            }
            if (uri.getPort() != -1 && uri.getPort() != 443) {
                return null;
            }
            String path = uri.getRawPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) {
                return null;
            }
            String normalizedHost = host.toLowerCase(Locale.ROOT);
            String expectedAuthority = normalizedHost + (uri.getPort() == 443 ? ":443" : "");
            String rawAuthority = uri.getRawAuthority();
            if (rawAuthority == null || !rawAuthority.equalsIgnoreCase(expectedAuthority)) {
                return null;
            }
            return "https://" + normalizedHost;
        } catch (Exception exception) {
            return null;
        }
    }

    static boolean isValidInstallationId(@Nullable String candidate) {
        return candidate != null && INSTALLATION_ID_PATTERN.matcher(candidate).matches();
    }

    static String generateInstallationId() {
        return UUID.randomUUID().toString();
    }

    private static String requireSafeLabel(@Nullable String candidate, String fieldName) {
        if (candidate == null || candidate.isEmpty() || candidate.length() > MAX_LABEL_LENGTH
            || !candidate.equals(candidate.trim()) || hasUnsafeIdentityCharacter(candidate)) {
            throw new IllegalArgumentException("Invalid " + fieldName + ".");
        }
        return candidate;
    }

    private static boolean hasUnsafeIdentityCharacter(String value) {
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
                || (codePoint >= 0x202a && codePoint <= 0x202e)
                || (codePoint >= 0x2066 && codePoint <= 0x2069)) {
                return true;
            }
            offset += Character.charCount(codePoint);
        }
        return false;
    }

    @Nullable
    private static String normalizeConfirmedAt(@Nullable String candidate) {
        if (candidate == null || candidate.isEmpty() || candidate.length() > MAX_CONFIRMED_AT_LENGTH) {
            return null;
        }
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        formatter.setLenient(false);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        ParsePosition position = new ParsePosition(0);
        Date parsed = formatter.parse(candidate, position);
        if (parsed == null || position.getIndex() != candidate.length()) {
            return null;
        }
        String canonical = formatter.format(parsed);
        return candidate.equals(canonical) ? canonical : null;
    }
}
