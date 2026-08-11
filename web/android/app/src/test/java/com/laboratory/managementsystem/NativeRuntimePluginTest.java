package com.laboratory.managementsystem;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class NativeRuntimePluginTest {
    @Test
    public void normalizeHttpsServerUrl_acceptsOnlyCanonicalHttpsOrigins() {
        assertEquals("https://example.com", NativeRuntimePlugin.normalizeHttpsServerUrl("https://example.com"));
        assertEquals("https://example.com", NativeRuntimePlugin.normalizeHttpsServerUrl("https://EXAMPLE.com/"));
        assertEquals("https://example.com", NativeRuntimePlugin.normalizeHttpsServerUrl("https://example.com:443/"));
        assertEquals("https://[2001:db8::1]", NativeRuntimePlugin.normalizeHttpsServerUrl("https://[2001:DB8::1]:443/"));
    }

    @Test
    public void normalizeHttpsServerUrl_rejectsNonOriginAndAmbiguousInputs() {
        String[] invalid = {
            null,
            "",
            " https://example.com",
            "https://example.com ",
            "http://example.com",
            "https://user@example.com",
            "https://user:password@example.com",
            "https://example.com?mode=pair",
            "https://example.com?",
            "https://example.com#fragment",
            "https://example.com:8443",
            "https://example.com:",
            "https://example.com/app",
            "https://example.com//",
            "https://example.com/%2F",
            "//example.com",
            "https:///missing-host"
        };

        for (String candidate : invalid) {
            assertNull(candidate, NativeRuntimePlugin.normalizeHttpsServerUrl(candidate));
        }
    }
}
