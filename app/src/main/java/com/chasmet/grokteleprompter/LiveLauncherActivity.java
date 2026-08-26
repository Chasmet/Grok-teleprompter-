package com.chasmet.grokteleprompter;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;

import java.util.ArrayList;

public final class LiveLauncherActivity extends Activity {
    private static final int REQUEST_RUNTIME = 3101;
    private static final int REQUEST_OVERLAY = 3102;
    private static final int REQUEST_CAPTURE = 3103;

    private String script = "Bienvenue dans Grok Téléprompteur Live.";
    private int speed = 3;
    private int fontSize = 36;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView loading = new TextView(this);
        loading.setText("Préparation du mode\nLIVE FOND D’ÉCRAN VERT");
        loading.setTextColor(Color.WHITE);
        loading.setTextSize(20);
        loading.setGravity(Gravity.CENTER);
        loading.setBackgroundColor(Color.rgb(7, 17, 31));
        setContentView(loading);
        readConfig(getIntent());
        beginPermissions();
    }

    private void readConfig(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null) return;
        String text = data.getQueryParameter("text");
        if (text != null && !text.trim().isEmpty()) script = text.trim();
        try { speed = clamp(Integer.parseInt(data.getQueryParameter("speed")), 1, 10); }
        catch (Exception ignored) {}
        try { fontSize = clamp(Integer.parseInt(data.getQueryParameter("size")), 20, 70); }
        catch (Exception ignored) {}
    }

    private void beginPermissions() {
        ArrayList<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!missing.isEmpty()) {
            requestPermissions(missing.toArray(new String[0]), REQUEST_RUNTIME);
            return;
        }
        continueLaunch();
    }

    private void continueLaunch() {
        if (!Settings.canDrawOverlays(this)) {
            try {
                Intent overlay = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())
                );
                startActivityForResult(overlay, REQUEST_OVERLAY);
            } catch (Exception error) {
                fail("Impossible d’ouvrir l’autorisation d’affichage flottant");
            }
            return;
        }
        requestScreenCapture();
    }

    private void requestScreenCapture() {
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            fail("Capture d’écran Android indisponible");
            return;
        }
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQUEST_RUNTIME) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail("Le mode Live a besoin de la caméra et du microphone");
            return;
        }
        continueLaunch();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_OVERLAY) {
            if (!Settings.canDrawOverlays(this)) {
                fail("Autorise l’affichage par-dessus les autres applications");
                return;
            }
            requestScreenCapture();
            return;
        }
        if (requestCode == REQUEST_CAPTURE) {
            if (resultCode != RESULT_OK || data == null) {
                fail("La capture d’écran est nécessaire pour enregistrer le Live");
                return;
            }
            startLiveService(resultCode, data);
        }
    }

    private void startLiveService(int resultCode, Intent resultData) {
        Intent service = new Intent(this, LiveOverlayService.class);
        service.setAction(LiveOverlayService.ACTION_START);
        service.putExtra(LiveOverlayService.EXTRA_RESULT_CODE, resultCode);
        service.putExtra(LiveOverlayService.EXTRA_RESULT_DATA, resultData);
        service.putExtra(LiveOverlayService.EXTRA_SCRIPT, script);
        service.putExtra(LiveOverlayService.EXTRA_SPEED, speed);
        service.putExtra(LiveOverlayService.EXTRA_FONT_SIZE, fontSize);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service);
        else startService(service);
        Toast.makeText(this, "Live lancé · navigation libre sur le téléphone", Toast.LENGTH_LONG).show();

        Intent home = new Intent(Intent.ACTION_MAIN);
        home.addCategory(Intent.CATEGORY_HOME);
        home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(home);
        finish();
    }

    private void fail(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
