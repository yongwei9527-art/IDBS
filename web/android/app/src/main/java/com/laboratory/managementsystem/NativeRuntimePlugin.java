package com.laboratory.managementsystem;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
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
 * The complete verified server identity is persisted as one versioned AES-GCM payload.
 * Pairing tokens, credentials and sessions are never written to native preferences.
 */
@CapacitorPlugin(name = "NativeRuntime")
public class NativeRuntimePlugin extends Plugin {
    private static final String PREFERENCES_NAME = "native_runtime_secure_config";
    private static final String INSTALLATION_ID = "installation_id_v1";
    private static final String CONFIGURATION_CIPHERTEXT = "trusted_server_configuration_v2_ciphertext";
    private static final String CONFIGURATION_IV = "trusted_server_configuration_v2_iv";
    private static final String LEGACY_SERVER_URL_CIPHERTEXT = "server_url_ciphertext";
    private static final String LEGACY_SERVER_URL_IV = "server_url_iv";
    private static final String LEGACY_KEYSTORE_ALIAS = "laboratory_management_server_config_v1";
    private static final String KEYSTORE_ALIAS = "laboratory_management_server_config_v2";
    private static final byte[] CONFIGURATION_AAD = "laboratory-management-system:trusted-server:v2"
        .getBytes(StandardCharsets.UTF_8);
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final int GCM_IV_LENGTH_BYTES = 12;

    private final SecureRandom secureRandom = new SecureRandom();
    private final Object installationIdLock = new Object();
    private final Object serverConfigurationLock = new Object();
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
        if (intent != null && getActivity() != null) {
            getActivity().setIntent(intent);
        }
        handlePairingIntent(intent);
    }

    @PluginMethod
    public void getConfiguration(PluginCall call) {
        boolean firebasePushConfigured = getContext().getResources().getIdentifier(
            "google_app_id", "string", getContext().getPackageName()
        ) != 0;
        JSObject result = new JSObject();
        result.put("firebasePushConfigured", firebasePushConfigured);
        synchronized (serverConfigurationLock) {
            result.put("serverConfigured", readServerConfiguration() != null);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void getInstallationId(PluginCall call) {
        synchronized (installationIdLock) {
            SharedPreferences preferences = getPreferences();
            String installationId = preferences.getString(INSTALLATION_ID, null);
            if (!TrustedServerConfiguration.isValidInstallationId(installationId)) {
                installationId = TrustedServerConfiguration.generateInstallationId();
                if (!preferences.edit().putString(INSTALLATION_ID, installationId).commit()) {
                    call.reject("Unable to persist the installation identifier.", "SECURE_STORAGE_ERROR");
                    return;
                }
            }
            JSObject result = new JSObject();
            result.put("installationId", installationId);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void getServerConfiguration(PluginCall call) {
        synchronized (serverConfigurationLock) {
            call.resolve(toJsObject(readServerConfiguration()));
        }
    }

    @PluginMethod
    public void saveServerConfiguration(PluginCall call) {
        final TrustedServerConfiguration candidate;
        try {
            candidate = TrustedServerConfiguration.create(
                call.getString("serverUrl"), call.getString("organizationName"),
                call.getString("instanceName"), call.getString("instanceId"),
                call.getString("fingerprint"), call.getString("confirmedAt")
            );
        } catch (IllegalArgumentException exception) {
            call.reject("Invalid trusted server configuration.", "INVALID_SERVER_CONFIGURATION", exception);
            return;
        }

        synchronized (serverConfigurationLock) {
            TrustedServerConfiguration existing = readServerConfiguration();
            boolean allowServerSwitch = Boolean.TRUE.equals(call.getBoolean("allowServerSwitch", false));
            if (!TrustedServerConfiguration.mayReplaceTrustedIdentity(existing, candidate, allowServerSwitch)) {
                call.reject(
                    "The trusted server identity changed and requires explicit confirmation.",
                    "SERVER_SWITCH_CONFIRMATION_REQUIRED"
                );
                return;
            }

            try {
                writeServerConfiguration(candidate);
                call.resolve(toJsObject(candidate));
            } catch (GeneralSecurityException | IOException exception) {
                call.reject("Unable to securely save the server configuration.", "SECURE_STORAGE_ERROR", exception);
            }
        }
    }

    @PluginMethod
    public void clearServerConfiguration(PluginCall call) {
        synchronized (serverConfigurationLock) {
            if (!clearStoredServerConfiguration()) {
                call.reject("Unable to clear the server configuration.", "SECURE_STORAGE_ERROR");
                return;
            }
            deleteKeystoreAlias(KEYSTORE_ALIAS);
            deleteKeystoreAlias(LEGACY_KEYSTORE_ALIAS);
            call.resolve();
        }
    }

    @PluginMethod
    public void ingestServerPairingLink(PluginCall call) {
        String pairingUri = call.getString("uri");
        JSObject pairing = parsePairingUri(pairingUri);
        if (pairing == null) {
            call.reject("Invalid server pairing link.", "INVALID_PAIRING_LINK");
            return;
        }
        setPendingPairing(pairing);
        call.resolve(pairing);
    }

    @PluginMethod
    public void getPendingServerPairing(PluginCall call) {
        JSObject result = new JSObject();
        result.put("pending", pendingPairing != null);
        if (pendingPairing != null) {
            result.put("pairing", pendingPairing);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledgeServerPairing(PluginCall call) {
        pendingPairing = null;
        call.resolve();
    }

    private void handlePairingIntent(@Nullable Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        JSObject pairing = parsePairingUri(intent.getDataString());
        if (pairing != null) {
            setPendingPairing(pairing);
        }
    }

    private void setPendingPairing(JSObject pairing) {
        pendingPairing = pairing;
        notifyListeners("serverPairingLink", pairing, true);
    }

    @Nullable
    private JSObject parsePairingUri(@Nullable String source) {
        if (source == null || source.length() > 4096) {
            return null;
        }
        try {
            PairingLinkParser.ParsedPairing pairing = PairingLinkParser.parse(source);
            if (pairing == null) return null;
            JSObject result = new JSObject();
            result.put("serverUrl", pairing.getServerUrl());
            result.put("pairingToken", pairing.getToken());
            result.put("version", pairing.getVersion());
            return result;
        } catch (RuntimeException exception) {
            return null;
        }
    }

    @Nullable
    static String normalizeHttpsServerUrl(@Nullable String candidate) {
        return TrustedServerConfiguration.normalizeHttpsServerUrl(candidate);
    }

    private JSObject toJsObject(@Nullable TrustedServerConfiguration configuration) {
        JSObject result = new JSObject();
        result.put("configured", configuration != null);
        if (configuration != null) {
            result.put("serverUrl", configuration.getServerUrl());
            result.put("organizationName", configuration.getOrganizationName());
            result.put("instanceName", configuration.getInstanceName());
            result.put("instanceId", configuration.getInstanceId());
            result.put("fingerprint", configuration.getFingerprint());
            result.put("confirmedAt", configuration.getConfirmedAt());
        }
        return result;
    }

    @Nullable
    private TrustedServerConfiguration readServerConfiguration() {
        SharedPreferences preferences = getPreferences();
        // URL-only storage can never be promoted to a trusted identity. Remove it even if a
        // complete v2 payload also exists (for example after an interrupted app upgrade).
        preferences.edit()
            .remove(LEGACY_SERVER_URL_CIPHERTEXT)
            .remove(LEGACY_SERVER_URL_IV)
            .apply();
        deleteKeystoreAlias(LEGACY_KEYSTORE_ALIAS);
        String ciphertextValue = preferences.getString(CONFIGURATION_CIPHERTEXT, null);
        String ivValue = preferences.getString(CONFIGURATION_IV, null);
        if (ciphertextValue == null || ivValue == null) {
            clearStoredServerConfiguration();
            return null;
        }
        try {
            byte[] iv = Base64.decode(ivValue, Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(ciphertextValue, Base64.NO_WRAP);
            if (iv.length != GCM_IV_LENGTH_BYTES || ciphertext.length <= GCM_TAG_LENGTH_BITS / 8) {
                throw new GeneralSecurityException("Invalid encrypted configuration length.");
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            cipher.updateAAD(CONFIGURATION_AAD);
            return TrustedServerConfiguration.decode(cipher.doFinal(ciphertext));
        } catch (Exception exception) {
            clearStoredServerConfiguration();
            return null;
        }
    }

    private void writeServerConfiguration(TrustedServerConfiguration configuration)
        throws GeneralSecurityException, IOException {
        byte[] iv = new byte[GCM_IV_LENGTH_BYTES];
        secureRandom.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
        cipher.updateAAD(CONFIGURATION_AAD);
        byte[] encrypted = cipher.doFinal(configuration.encode());
        boolean committed = getPreferences().edit()
            .putString(CONFIGURATION_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(CONFIGURATION_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
            .remove(LEGACY_SERVER_URL_CIPHERTEXT)
            .remove(LEGACY_SERVER_URL_IV)
            .commit();
        if (!committed) {
            throw new GeneralSecurityException("Unable to commit the trusted server configuration.");
        }
    }

    private SecretKey getOrCreateKey() throws GeneralSecurityException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        try {
            keyStore.load(null);
        } catch (IOException exception) {
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

    private void deleteKeystoreAlias(String alias) {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias);
            }
        } catch (GeneralSecurityException | IOException ignored) {
            // Preference removal is the trust boundary. An orphaned key contains no server
            // identity and is retried on the next read or explicit clear.
        }
    }

    private boolean clearStoredServerConfiguration() {
        return getPreferences().edit()
            .remove(CONFIGURATION_CIPHERTEXT)
            .remove(CONFIGURATION_IV)
            .remove(LEGACY_SERVER_URL_CIPHERTEXT)
            .remove(LEGACY_SERVER_URL_IV)
            .commit();
    }
}
