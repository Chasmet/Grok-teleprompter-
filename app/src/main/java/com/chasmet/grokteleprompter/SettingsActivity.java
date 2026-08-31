package com.chasmet.grokteleprompter;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.DecimalFormat;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SettingsActivity extends Activity {
    private static final String RELEASE_API = "https://api.github.com/repos/Chasmet/Grok-teleprompter-/releases/latest";
    private static final String USER_AGENT = "Grok-Teleprompter-Android/" + BuildConfig.VERSION_NAME;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView currentVersionText;
    private TextView latestVersionText;
    private TextView updateStatusText;
    private TextView updateDetailsText;
    private TextView progressText;
    private ProgressBar progressBar;
    private Button checkButton;
    private Button updateButton;
    private UpdateInfo latestUpdate;
    private File pendingInstallFile;
    private boolean downloading;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(7, 17, 31));
        getWindow().setNavigationBarColor(Color.rgb(5, 11, 31));
        setContentView(buildUi());
        checkForUpdate();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(5, 11, 31));

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(20), dp(22), dp(20), dp(40));
        scroll.addView(page, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT
        ));

        Button back = button("‹ Retour", 0xFF172554);
        back.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(dp(112), dp(46));
        backLp.bottomMargin = dp(18);
        page.addView(back, backLp);

        TextView badge = text("GROK TÉLÉPROMPTEUR STUDIO", 14, 0xFFC7D7FE, true);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(round(0x221D4ED8, 0x885D7CFA, 999, 1));
        page.addView(badge, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(46)
        ));

        TextView title = text("Réglages", 34, Color.WHITE, true);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(-1, -2);
        titleLp.topMargin = dp(18);
        page.addView(title, titleLp);

        TextView intro = text("Mises à jour internes, version de l’application et installation sans perdre tes réglages.", 16, 0xFFAFC2E4, false);
        LinearLayout.LayoutParams introLp = new LinearLayout.LayoutParams(-1, -2);
        introLp.topMargin = dp(6);
        introLp.bottomMargin = dp(20);
        page.addView(intro, introLp);

        LinearLayout versionCard = card();
        page.addView(versionCard, cardLp());
        versionCard.addView(text("APPLICATION", 12, 0xFF93C5FD, true));
        currentVersionText = text("Version installée : " + BuildConfig.VERSION_NAME, 20, Color.WHITE, true);
        addTop(versionCard, currentVersionText, 8);
        TextView packageText = text("com.chasmet.grokteleprompter", 13, 0xFF8396B7, false);
        addTop(versionCard, packageText, 5);

        LinearLayout updateCard = card();
        page.addView(updateCard, cardLp());
        updateCard.addView(text("MISE À JOUR INTERNE", 12, 0xFF6EE7B7, true));

        updateStatusText = text("Recherche d’une mise à jour…", 21, Color.WHITE, true);
        addTop(updateCard, updateStatusText, 8);
        latestVersionText = text("Dernière version : vérification…", 15, 0xFFAFC2E4, false);
        addTop(updateCard, latestVersionText, 6);
        updateDetailsText = text("", 14, 0xFF94A3B8, false);
        addTop(updateCard, updateDetailsText, 8);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        progressBar.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressLp = new LinearLayout.LayoutParams(-1, dp(18));
        progressLp.topMargin = dp(18);
        updateCard.addView(progressBar, progressLp);

        progressText = text("0 %", 15, 0xFFDDE8FF, true);
        progressText.setGravity(Gravity.CENTER);
        progressText.setVisibility(View.GONE);
        addTop(updateCard, progressText, 7);

        updateButton = button("Mettre à jour", 0xFF059669);
        updateButton.setEnabled(false);
        updateButton.setOnClickListener(v -> startUpdate());
        LinearLayout.LayoutParams updateLp = new LinearLayout.LayoutParams(-1, dp(54));
        updateLp.topMargin = dp(16);
        updateCard.addView(updateButton, updateLp);

        checkButton = button("Rechercher une mise à jour", 0xFF1E3A8A);
        checkButton.setOnClickListener(v -> checkForUpdate());
        LinearLayout.LayoutParams checkLp = new LinearLayout.LayoutParams(-1, dp(50));
        checkLp.topMargin = dp(10);
        updateCard.addView(checkButton, checkLp);

        LinearLayout infoCard = card();
        page.addView(infoCard, cardLp());
        infoCard.addView(text("COMMENT ÇA MARCHE", 12, 0xFFFBBF24, true));
        addTop(infoCard, text(
                "1. L’application vérifie automatiquement la dernière version publiée.\n" +
                "2. Si une MAJ existe, tu appuies sur Mettre à jour.\n" +
                "3. Le téléchargement affiche le pourcentage en direct.\n" +
                "4. À 100 %, Android ouvre l’installation de la nouvelle version.\n" +
                "5. Les prochaines versions gardent les données de l’application grâce à la signature stable.",
                15, 0xFFC7D2E6, false), 10);

        TextView transition = text(
                "Important : la v2.17.0 devient la nouvelle base de signature stable. Après cette version de transition, les mises à jour suivantes pourront s’installer directement par-dessus l’application.",
                14, 0xFFFDE68A, true);
        LinearLayout.LayoutParams transitionLp = new LinearLayout.LayoutParams(-1, -2);
        transitionLp.topMargin = dp(14);
        infoCard.addView(transition, transitionLp);

        return scroll;
    }

    private void checkForUpdate() {
        if (downloading) return;
        checkButton.setEnabled(false);
        updateButton.setEnabled(false);
        updateStatusText.setText("Recherche d’une mise à jour…");
        latestVersionText.setText("Dernière version : vérification…");
        updateDetailsText.setText("");
        hideProgress();

        executor.execute(() -> {
            try {
                JSONObject release = new JSONObject(readText(RELEASE_API));
                String tag = release.optString("tag_name", "").trim();
                String version = tag.startsWith("v") ? tag.substring(1) : tag;
                if (version.isEmpty()) throw new IllegalStateException("Version GitHub absente");

                JSONArray assets = release.optJSONArray("assets");
                if (assets == null) throw new IllegalStateException("Aucun APK publié");
                String apkUrl = null;
                long apkSize = 0;
                String digest = null;
                String apkName = null;
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    String name = asset.optString("name", "");
                    if (name.toLowerCase(Locale.ROOT).endsWith(".apk")) {
                        apkName = name;
                        apkUrl = asset.optString("browser_download_url", null);
                        apkSize = asset.optLong("size", 0L);
                        digest = asset.optString("digest", null);
                        break;
                    }
                }
                if (apkUrl == null) throw new IllegalStateException("APK de mise à jour introuvable");

                UpdateInfo info = new UpdateInfo(
                        version,
                        apkName == null ? "Grok-Teleprompter.apk" : apkName,
                        apkUrl,
                        apkSize,
                        digest,
                        release.optString("body", ""),
                        release.optString("published_at", "")
                );
                latestUpdate = info;
                boolean newer = compareVersions(info.version, BuildConfig.VERSION_NAME) > 0;
                runOnUiThread(() -> showCheckResult(info, newer));
            } catch (Exception error) {
                runOnUiThread(() -> {
                    checkButton.setEnabled(true);
                    updateStatusText.setText("Impossible de vérifier la MAJ");
                    latestVersionText.setText("Connexion à GitHub indisponible");
                    updateDetailsText.setText(error.getMessage() == null ? "Réessaie dans quelques secondes." : error.getMessage());
                });
            }
        });
    }

    private void showCheckResult(UpdateInfo info, boolean newer) {
        checkButton.setEnabled(true);
        latestVersionText.setText("Dernière version : " + info.version);
        if (newer) {
            updateStatusText.setText("Mise à jour disponible");
            updateStatusText.setTextColor(0xFF6EE7B7);
            updateButton.setEnabled(true);
            updateButton.setText("Mettre à jour vers " + info.version);
        } else {
            updateStatusText.setText("Application à jour");
            updateStatusText.setTextColor(0xFF93C5FD);
            updateButton.setEnabled(false);
            updateButton.setText("Aucune mise à jour");
        }
        String size = info.size > 0 ? formatBytes(info.size) : "taille inconnue";
        String notes = info.notes == null ? "" : info.notes.trim();
        if (notes.length() > 700) notes = notes.substring(0, 700) + "…";
        updateDetailsText.setText("APK : " + size + (notes.isEmpty() ? "" : "\n\n" + notes));
    }

    private void startUpdate() {
        if (latestUpdate == null || downloading) {
            checkForUpdate();
            return;
        }
        downloading = true;
        checkButton.setEnabled(false);
        updateButton.setEnabled(false);
        updateButton.setText("Téléchargement en cours…");
        updateStatusText.setText("Téléchargement de la mise à jour");
        showProgress(0, 0, latestUpdate.size);

        UpdateInfo info = latestUpdate;
        executor.execute(() -> {
            try {
                File downloads = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates");
                if (!downloads.exists() && !downloads.mkdirs()) {
                    throw new IllegalStateException("Impossible de préparer le dossier de mise à jour");
                }
                File target = new File(downloads, "Grok-Teleprompter-update.apk");
                download(info, target);
                if (info.digest != null && info.digest.startsWith("sha256:")) {
                    String expected = info.digest.substring("sha256:".length()).trim();
                    String actual = sha256(target);
                    if (!expected.equalsIgnoreCase(actual)) {
                        target.delete();
                        throw new IllegalStateException("Vérification de sécurité de l’APK échouée");
                    }
                }
                pendingInstallFile = target;
                runOnUiThread(() -> {
                    downloading = false;
                    showProgress(100, target.length(), target.length());
                    updateStatusText.setText("Téléchargement terminé · prêt à installer");
                    updateButton.setText("Installer maintenant");
                    updateButton.setEnabled(true);
                    checkButton.setEnabled(true);
                    requestInstall(target);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    downloading = false;
                    checkButton.setEnabled(true);
                    updateButton.setEnabled(true);
                    updateButton.setText("Réessayer la mise à jour");
                    updateStatusText.setText("Échec du téléchargement");
                    updateDetailsText.setText(error.getMessage() == null ? "Téléchargement interrompu." : error.getMessage());
                });
            }
        });
    }

    private void download(UpdateInfo info, File target) throws Exception {
        HttpURLConnection connection = openConnection(info.url);
        long total = info.size > 0 ? info.size : connection.getContentLengthLong();
        long downloaded = 0;
        int lastPercent = -1;
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                downloaded += read;
                int percent = total > 0 ? (int) Math.min(100, downloaded * 100L / total) : 0;
                if (percent != lastPercent) {
                    lastPercent = percent;
                    long finalDownloaded = downloaded;
                    long finalTotal = total;
                    int finalPercent = percent;
                    runOnUiThread(() -> showProgress(finalPercent, finalDownloaded, finalTotal));
                }
            }
            output.flush();
        } finally {
            connection.disconnect();
        }
        if (target.length() < 1024 * 1024) {
            target.delete();
            throw new IllegalStateException("Le fichier téléchargé n’est pas un APK valide");
        }
    }

    private void requestInstall(File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            pendingInstallFile = apk;
            updateStatusText.setText("Autorise Grok Téléprompteur à installer la MAJ");
            try {
                Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                startActivity(permission);
            } catch (Exception error) {
                toast("Active l’installation d’applications inconnues pour Grok Téléprompteur");
            }
            return;
        }
        launchInstaller(apk);
    }

    private void launchInstaller(File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(
                    this,
                    getPackageName() + ".fileprovider",
                    apk
            );
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(install);
            updateStatusText.setText("Installation Android ouverte");
        } catch (Exception error) {
            updateStatusText.setText("Impossible d’ouvrir l’installation");
            toast("Installation impossible : " + error.getMessage());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstallFile != null && pendingInstallFile.exists()
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls())) {
            File apk = pendingInstallFile;
            pendingInstallFile = null;
            getWindow().getDecorView().postDelayed(() -> launchInstaller(apk), 350);
        }
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private String readText(String url) throws Exception {
        HttpURLConnection connection = openConnection(url);
        try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
            byte[] bytes = input.readAllBytes();
            return new String(bytes, StandardCharsets.UTF_8);
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection openConnection(String url) throws Exception {
        URL current = new URL(url);
        for (int i = 0; i < 6; i++) {
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IllegalStateException("Redirection de téléchargement invalide");
                current = new URL(current, location);
                continue;
            }
            if (code < 200 || code >= 300) {
                connection.disconnect();
                throw new IllegalStateException("Serveur de mise à jour : HTTP " + code);
            }
            return connection;
        }
        throw new IllegalStateException("Trop de redirections de téléchargement");
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    private int compareVersions(String a, String b) {
        String[] left = a.replaceAll("[^0-9.]", "").split("\\.");
        String[] right = b.replaceAll("[^0-9.]", "").split("\\.");
        int max = Math.max(left.length, right.length);
        for (int i = 0; i < max; i++) {
            int lv = i < left.length && !left[i].isEmpty() ? Integer.parseInt(left[i]) : 0;
            int rv = i < right.length && !right[i].isEmpty() ? Integer.parseInt(right[i]) : 0;
            if (lv != rv) return Integer.compare(lv, rv);
        }
        return 0;
    }

    private void showProgress(int percent, long downloaded, long total) {
        progressBar.setVisibility(View.VISIBLE);
        progressText.setVisibility(View.VISIBLE);
        progressBar.setProgress(percent);
        String totalText = total > 0 ? " / " + formatBytes(total) : "";
        progressText.setText(percent + " %  ·  " + formatBytes(downloaded) + totalText);
    }

    private void hideProgress() {
        progressBar.setVisibility(View.GONE);
        progressText.setVisibility(View.GONE);
        progressBar.setProgress(0);
    }

    private String formatBytes(long bytes) {
        if (bytes <= 0) return "0 Mo";
        double mb = bytes / (1024d * 1024d);
        return new DecimalFormat("0.0").format(mb) + " Mo";
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setBackground(round(0xEE0B1730, 0x554A6DA7, 18, 1));
        return card;
    }

    private LinearLayout.LayoutParams cardLp() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = dp(14);
        return lp;
    }

    private void addTop(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(top);
        parent.addView(child, lp);
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0f, 1.12f);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    private Button button(String value, int fill) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        button.setBackground(round(fill, 0x775D7CFA, 14, 1));
        return button;
    }

    private GradientDrawable round(int fill, int stroke, int radiusDp, int strokeWidthDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeWidthDp > 0) drawable.setStroke(dp(strokeWidthDp), stroke);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private static final class UpdateInfo {
        final String version;
        final String fileName;
        final String url;
        final long size;
        final String digest;
        final String notes;
        final String publishedAt;

        UpdateInfo(String version, String fileName, String url, long size, String digest, String notes, String publishedAt) {
            this.version = version;
            this.fileName = fileName;
            this.url = url;
            this.size = size;
            this.digest = digest;
            this.notes = notes;
            this.publishedAt = publishedAt;
        }
    }
}
