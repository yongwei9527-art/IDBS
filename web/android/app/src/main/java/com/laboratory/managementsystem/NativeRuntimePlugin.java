package com.laboratory.managementsystem;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Native capabilities intentionally kept dependency-free so a locally built APK does not
 * rely on an unavailable scanner or third-party configuration SDK.
 *
 * Server pairing is a two-step protocol: this plugin validates and relays a short-lived
 * pairing URI, while the web layer exchanges the token with the selected server over HTTPS.
 * Only the verified canonical server URL is persisted. Pairing tokens, credentials and
 * sessions are never written to native preferences by this plugin.
 */
@CapacitorPlugin(name = "NativeRuntime")
public class NativeRuntimePlugin extends Plugin {
    private static final String PREFERENCES_NAME = "native_runtime_secure_config";
    private static final String SERVER_URL_CIPHERTEXT = "server_url_ciphertext";
    private static final String SERVER_URL_IV = "server_url_iv";
    private static final String KEYSTORE_ALIAS = "laboratory_management_server_config_v1";
    private static final String PAIRING_SCHEME = "labapp";
    private static final String PAIRING_HOST = "pair";
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final int GCM_IV_LENGTH_BYTES = 12;

    private final SecureRandom secureRandom = new SecureRandom();
    @Nullable
    private JSObject pendingPairing;

    @Override
    public void load() {
        super.load();
        handlePairingIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handlePairingIntent(intent);
    }

    /** Existing capability retained for compatibility with the web runtime. */
    @PluginMethod
    public void getConfiguration(PluginCall call) {
        boolean firebasePushConfigured = getContext().getResources().getIdentifier(
            "google_app_id", "string", getContext().getPackageName()
        ) != 0;

        JSObject result = new JSObject();
        result.put("firebasePushConfigured", firebasePushConfigured);
        result.put("serverConfigured", readServerUrl() != null);
        call.resolve(result);
    }

    /** Returns only the verified server URL; no pairing token or authentication data is exposed. */
    @PluginMethod
    public void getServerConfiguration(PluginCall call) {
        String serverUrl = readServerUrl();
        JSObject result = new JSObject();
        result.put("configured", serverUrl != null);
        if (serverUrl != null) {
            result.put("serverUrl", serverUrl);
        }
        call.resolve(result);
    }

    /**
     * Persists a canonical HTTPS server URL after the web layer has exchanged and validated a
     * one-time pairing token. The value is AES-GCM encrypted with an Android Keystore key.
     */
    @PluginMethod
    public void saveServerConfiguration(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        String normalizedUrl = normalizeHttpsServerUrl(serverUrl);
        if (normalizedUrl == null) {
            call.reject("serverUrl 必须是有效的 HTTPS 服务器地址，且不能包含账号、密码、片段或非 443 端口。", "INVALID_SERVER_URL");
            return;
        }

        try {
            writeServerUrl(normalizedUrl);
            JSObject result = new JSObject();
            result.put("configured", true);
            result.put("serverUrl", normalizedUrl);
            call.resolve(result);
        } catch (GeneralSecurityException exception) {
            call.reject("无法安全保存服务器配置。", "SECURE_STORAGE_ERROR", exception);
        }
    }

    @PluginMethod
    public void clearServerConfiguration(PluginCall call) {
        clearServerUrl();
        call.resolve();
    }

    /**
     * Accepts the same URI returned by a future camera scanner. It validates the address but
     * intentionally keeps the one-time token in memory only until the web layer exchanges it.
     */
    @PluginMethod
    public void ingestServerPairingLink(PluginCall call) {
        String pairingUri = call.getString("uri");
        JSObject pairing = parsePairingUri(pairingUri);
        if (pairing == null) {
            call.reject("无效的服务器配对二维码。", "INVALID_PAIRING_LINK");
            return;
        }
        setPendingPairing(pairing);
        call.resolve(pairing);
    }

    /** Retrieves a pending pairing payload after an app deep link or scanner result. */
    @PluginMethod
    public void getPendingServerPairing(PluginCall call) {
        JSObject result = new JSObject();
        result.put("pending", pendingPairing != null);
        if (pendingPairing != null) {
            result.put("pairing", pendingPairing);
        }
        call.resolve(result);
    }

    /** Call only after the server has accepted or rejected the pairing token. */
    @PluginMethod
    public void acknowledgeServerPairing(PluginCall call) {
        pendingPairing = null;
        call.resolve();
    }

    private void handlePairingIntent(@Nullable Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri data = intent.getData();
        JSObject pairing = parsePairingUri(data == null ? null : data.toString());
        if (pairing != null) {
            setPendingPairing(pairing);
        }
    }

    private void setPendingPairing(JSObject pairing) {
        pendingPairing = pairing;
        // Retain the event until the Capacitor web runtime attaches its listener.
        notifyListeners("serverPairingLink", pairing, true);
    }

    @Nullable
    private JSObject parsePairingUri(@Nullable String source) {
        if (source == null || source.length() > 4096) {
            return null;
        }
        try {
            Uri uri = Uri.parse(source);
            if (!PAIRING_SCHEME.equalsIgnoreCase(uri.getScheme()) || !PAIRING_HOST.equalsIgnoreCase(uri.getHost())) {
                return null;
            }
            String normalizedUrl = normalizeHttpsServerUrl(uri.getQueryParameter("server"));
            String pairingToken = uri.getQueryParameter("token");
            if (normalizedUrl == null || pairingToken == null || pairingToken.trim().length() < 16 || pairingToken.length() > 2048) {
                return null;
            }
            JSObject result = new JSObject();
            result.put("serverUrl", normalizedUrl);
            result.put("pairingToken", pairingToken);
            result.put("version", uri.getQueryParameter("v") == null ? "1" : uri.getQueryParameter("v"));
            return result;
        } catch (RuntimeException exception) {
            return null;
        }
    }

    @Nullable
    private String normalizeHttpsServerUrl(@Nullable String candidate) {
        if (candidate == null || candidate.length() > 2048) {
            return null;
        }
        try {
            URI uri = new URI(candidate.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null || uri.getRawQuery() != null) {
                return null;
            }
            if (uri.getPort() != -1 && uri.getPort() != 443) {
                return null;
            }
            String path = uri.getRawPath();
            if (path == null || path.isEmpty()) {
                path = "";
            }
            String port = uri.getPort() == 443 ? "" : "";
            return "https://" + uri.getHost().toLowerCase() + port + path;
        } catch (Exception exception) {
            return null;
        }
    }

    @Nullable
    private String readServerUrl() {
        SharedPreferences preferences = getPreferences();
        String ciphertext = preferences.getString(SERVER_URL_CIPHERTEXT, null);
        String iv = preferences.getString(SERVER_URL_IV, null);
        if (ciphertext == null || iv == null) {
            return null;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(iv, Base64.NO_WRAP)));
            return normalizeHttpsServerUrl(new String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception exception) {
            // Keystore invalidation or a corrupted value must fail closed.
            clearServerUrl();
            return null;
        }
    }

    private void writeServerUrl(String serverUrl) throws GeneralSecurityException {
        byte[] iv = new byte[GCM_IV_LENGTH_BYTES];
        secureRandom.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
        byte[] encrypted = cipher.doFinal(serverUrl.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        getPreferences().edit()
            .putString(SERVER_URL_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(SERVER_URL_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
            .apply();
    }

    private SecretKey getOrCreateKey() throws GeneralSecurityException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        try {
            keyStore.load(null);
        } catch (java.io.IOException exception) {
            throw new GeneralSecurityException("Unable to load Android Keystore.", exception);
        }
        KeyStore.Entry entry = keyStore.getEntry(KEYSTORE_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        keyGenerator.init(new KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return keyGenerator.generateKey();
    }

    private SharedPreferences getPreferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private void clearServerUrl() {
        getPreferences().edit().remove(SERVER_URL_CIPHERTEXT).remove(SERVER_URL_IV).apply();
    }
}