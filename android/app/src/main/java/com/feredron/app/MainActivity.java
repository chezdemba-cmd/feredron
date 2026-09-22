package com.feredron.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

/**
 * `getUserMedia({audio:true})` (bouton micro /ai, cf. MicButton.tsx) est une
 * API web standard : dans une WebView Android, elle exige :
 *  (1) RECORD_AUDIO déclarée ET accordée à l'exécution ;
 *  (2) MODIFY_AUDIO_SETTINGS déclarée — sans elle, le sous-système audio
 *      Android refuse de céder le micro à la WebView MÊME quand RECORD_AUDIO
 *      est accordée : la requête échoue en NotReadableError ("déjà utilisé
 *      par une autre application"), constaté en test réel le 2026-09-22 ;
 *  (3) un WebChromeClient qui répond explicitement à onPermissionRequest —
 *      sans cela, l'appel JS ne résout ni ne rejette JAMAIS (page figée), le
 *      WebChromeClient par défaut refusant silencieusement toute permission.
 */
public class MainActivity extends BridgeActivity {
    private static final int RC_RECORD_AUDIO = 4201;
    private static final String[] AUDIO_PERMISSIONS = {
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.MODIFY_AUDIO_SETTINGS,
    };
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (hasAllAudioPermissions()) {
                        request.grant(request.getResources());
                        return;
                    }
                    pendingWebPermissionRequest = request;
                    ActivityCompat.requestPermissions(MainActivity.this, AUDIO_PERMISSIONS, RC_RECORD_AUDIO);
                });
            }
        });
    }

    private boolean hasAllAudioPermissions() {
        for (String p : AUDIO_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != RC_RECORD_AUDIO || pendingWebPermissionRequest == null) return;
        if (hasAllAudioPermissions()) {
            pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
        } else {
            pendingWebPermissionRequest.deny();
        }
        pendingWebPermissionRequest = null;
    }
}
