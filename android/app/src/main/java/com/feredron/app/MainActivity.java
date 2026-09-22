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
 * API web standard : dans une WebView Android, elle exige (1) la permission
 * RECORD_AUDIO déclarée dans le manifeste ET accordée à l'exécution, ET (2)
 * un WebChromeClient qui répond explicitement à onPermissionRequest — sans
 * cela, l'appel JS ne résout ni ne rejette JAMAIS (page qui semble figée),
 * le WebChromeClient par défaut refusant silencieusement toute permission.
 */
public class MainActivity extends BridgeActivity {
    private static final int RC_RECORD_AUDIO = 4201;
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                        return;
                    }
                    pendingWebPermissionRequest = request;
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[] { Manifest.permission.RECORD_AUDIO },
                            RC_RECORD_AUDIO);
                });
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != RC_RECORD_AUDIO || pendingWebPermissionRequest == null) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
        } else {
            pendingWebPermissionRequest.deny();
        }
        pendingWebPermissionRequest = null;
    }
}
