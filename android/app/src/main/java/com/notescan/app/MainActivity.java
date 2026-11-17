package com.notescan.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new NoteScanNativeBridge(this), "NoteScanNative");
        }
    }

    private static class NoteScanNativeBridge {
        private final Context context;

        NoteScanNativeBridge(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public String saveFileToDevice(String base64Data, String fileName, String mimeType) {
            JSONObject result = new JSONObject();
            try {
                if (base64Data == null || base64Data.isEmpty()) {
                    throw new IllegalArgumentException("Empty file data");
                }
                String cleanBase64 = base64Data;
                int commaIdx = cleanBase64.indexOf(',');
                if (cleanBase64.startsWith("data:") && commaIdx > 0) {
                    cleanBase64 = cleanBase64.substring(commaIdx + 1);
                }
                byte[] bytes = Base64.decode(cleanBase64, Base64.DEFAULT);

                String safeName = (fileName != null && !fileName.trim().isEmpty())
                        ? fileName.trim().replaceAll("[\\\\/:*?\"<>|]", "_")
                        : ("NoteScan_" + System.currentTimeMillis() + ".jpg");
                String effectiveMime = (mimeType != null && !mimeType.trim().isEmpty())
                        ? mimeType.trim()
                        : "image/jpeg";
                boolean isImage = effectiveMime.startsWith("image/");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = context.getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, effectiveMime);
                    String relDir = isImage
                            ? (Environment.DIRECTORY_PICTURES + "/NoteScan")
                            : (Environment.DIRECTORY_DOWNLOADS + "/NoteScan");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, relDir);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                    Uri collection = isImage
                            ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                            : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                    Uri itemUri = resolver.insert(collection, values);
                    if (itemUri == null) {
                        throw new IllegalStateException("Failed to create MediaStore entry");
                    }

                    try (OutputStream out = resolver.openOutputStream(itemUri)) {
                        if (out == null) {
                            throw new IllegalStateException("Failed to open output stream");
                        }
                        out.write(bytes);
                        out.flush();
                    }

                    ContentValues clearPending = new ContentValues();
                    clearPending.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    resolver.update(itemUri, clearPending, null, null);

                    result.put("success", true);
                    result.put("fileName", safeName);
                    result.put("location", relDir);
                    result.put("uri", itemUri.toString());
                } else {
                    String dirType = isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS;
                    File baseDir = context.getExternalFilesDir(dirType);
                    File outDir = new File(baseDir, "NoteScan");
                    if (!outDir.exists()) {
                        outDir.mkdirs();
                    }
                    File outFile = new File(outDir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(bytes);
                        fos.flush();
                    }
                    MediaScannerConnection.scanFile(context, new String[]{outFile.getAbsolutePath()}, new String[]{effectiveMime}, null);

                    result.put("success", true);
                    result.put("fileName", safeName);
                    result.put("location", outFile.getAbsolutePath());
                }
            } catch (Exception e) {
                try {
                    result.put("success", false);
                    result.put("error", e.getMessage() != null ? e.getMessage() : "Save failed");
                } catch (Exception ignored) {}
            }
            return result.toString();
        }
    }
}
