package com.hquip.compositor;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "CompositorClipboard")
public class CompositorClipboardPlugin extends Plugin {
    private static final int MAX_BYTES = 64 * 1024 * 1024;

    @PluginMethod
    public void readImage(PluginCall call) {
        getBridge().execute(() -> {
            Bitmap bitmap = null;
            try {
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
                if (clip == null || clip.getItemCount() == 0) { call.resolve(new JSObject()); return; }
                ClipData.Item item = clip.getItemAt(0);
                CharSequence text = item.getText();
                if (text != null && text.toString().startsWith("data:image/")) {
                    if (text.length() > MAX_BYTES * 4 / 3 + 128) throw new IllegalArgumentException("The clipboard image exceeds the file-size limit.");
                    JSObject result = new JSObject(); result.put("data", text.toString()); call.resolve(result); return;
                }
                Uri uri = item.getUri();
                if (uri == null || !"content".equals(uri.getScheme())) { call.resolve(new JSObject()); return; }
                String type = getContext().getContentResolver().getType(uri);
                if ((type == null || !type.startsWith("image/")) && !clip.getDescription().hasMimeType("image/*")) { call.resolve(new JSObject()); return; }
                byte[] bytes;
                try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new IllegalArgumentException("Could not read the clipboard image.");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > MAX_BYTES) throw new IllegalArgumentException("The clipboard image exceeds the file-size limit.");
                        output.write(buffer, 0, count);
                    }
                    bytes = output.toByteArray();
                }
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                if (bounds.outWidth < 1 || bounds.outHeight < 1 || bounds.outWidth > 8192 || bounds.outHeight > 8192 || (long) bounds.outWidth * bounds.outHeight > 16_000_000) throw new IllegalArgumentException("The clipboard image exceeds the supported dimensions.");
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) throw new IllegalArgumentException("Could not read the clipboard image.");
                try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IllegalArgumentException("Could not read the clipboard image.");
                    JSObject result = new JSObject(); result.put("data", "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)); call.resolve(result);
                }
            } catch (Exception error) { call.reject(error.getMessage() == null ? "Could not read the clipboard image." : error.getMessage()); }
            finally { if (bitmap != null) bitmap.recycle(); }
        });
    }
}
