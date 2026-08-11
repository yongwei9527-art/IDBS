package com.laboratory.managementsystem;

import androidx.annotation.Nullable;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** Strict, Android-independent parser for v2 custom-scheme and verified HTTPS pairing links. */
final class PairingLinkParser {
    static final String VERSION = "2";
    static final String HTTPS_PATH = "/api/v5/app-pairing/link";

    private static final int MAX_LINK_LENGTH = 4096;
    private static final Pattern TOKEN_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{16,2048}$");

    private PairingLinkParser() {}

    @Nullable
    static ParsedPairing parse(@Nullable String source) {
        if (source == null || source.isEmpty() || source.length() > MAX_LINK_LENGTH
            || !source.equals(source.trim())) {
            return null;
        }
        try {
            URI uri = new URI(source);
            if (uri.isOpaque() || uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
                return null;
            }

            boolean customScheme = "labapp".equalsIgnoreCase(uri.getScheme())
                && "pair".equalsIgnoreCase(uri.getHost())
                && uri.getPort() == -1
                && (uri.getRawPath() == null || uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()));
            boolean httpsAppLink = "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && !uri.getHost().isEmpty()
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && HTTPS_PATH.equals(uri.getRawPath());
            if (!customScheme && !httpsAppLink) {
                return null;
            }

            Map<String, String> parameters = parseExactQuery(uri.getRawQuery());
            if (parameters == null || !VERSION.equals(parameters.get("v"))) {
                return null;
            }
            String serverUrl = TrustedServerConfiguration.normalizeHttpsServerUrl(parameters.get("server"));
            String token = parameters.get("token");
            if (serverUrl == null || token == null || !TOKEN_PATTERN.matcher(token).matches()) {
                return null;
            }

            if (httpsAppLink) {
                String linkOrigin = TrustedServerConfiguration.normalizeHttpsServerUrl(
                    "https://" + uri.getRawAuthority()
                );
                if (!serverUrl.equals(linkOrigin)) {
                    return null;
                }
            }
            return new ParsedPairing(VERSION, serverUrl, token);
        } catch (Exception exception) {
            return null;
        }
    }

    @Nullable
    private static Map<String, String> parseExactQuery(@Nullable String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) {
            return null;
        }
        Map<String, String> parameters = new HashMap<>();
        String[] fields = rawQuery.split("&", -1);
        if (fields.length != 3) {
            return null;
        }
        for (String field : fields) {
            int separator = field.indexOf('=');
            if (separator <= 0 || separator != field.lastIndexOf('=')) {
                return null;
            }
            String key = decode(field.substring(0, separator));
            String value = decode(field.substring(separator + 1));
            if (key == null || value == null || !("v".equals(key) || "server".equals(key) || "token".equals(key))
                || parameters.put(key, value) != null) {
                return null;
            }
        }
        return parameters.size() == 3 ? parameters : null;
    }

    @Nullable
    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (Exception exception) {
            return null;
        }
    }

    static final class ParsedPairing {
        private final String version;
        private final String serverUrl;
        private final String token;

        ParsedPairing(String version, String serverUrl, String token) {
            this.version = version;
            this.serverUrl = serverUrl;
            this.token = token;
        }

        String getVersion() { return version; }
        String getServerUrl() { return serverUrl; }
        String getToken() { return token; }
    }
}
