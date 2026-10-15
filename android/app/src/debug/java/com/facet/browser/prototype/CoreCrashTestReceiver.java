package com.facet.browser.prototype;

import android.content.*;
import android.content.pm.ApplicationInfo;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Debug APK only, DUMP-protected: simulate native process death in its actual SELinux domain. */
public class CoreCrashTestReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        if((context.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        if(!"com.facet.browser.prototype.TEST_CORE_DEATH".equals(intent.getAction()))return;
        try {
            File directory=new File(context.getFilesDir(),"core-profile1");
            int pid=Integer.parseInt(new String(Files.readAllBytes(new File(directory,"pid").toPath()),StandardCharsets.UTF_8).trim());
            String[] args=new String(Files.readAllBytes(new File("/proc/"+pid+"/cmdline").toPath()),StandardCharsets.UTF_8).split("\u0000");
            String binary=new File(context.getApplicationInfo().nativeLibraryDir,"libfacet_mihomo.so").getAbsolutePath();
            if(pid>0&&args.length>0&&args[0].equals(binary)&&Arrays.asList(args).contains(new File(directory,"runtime.json").getAbsolutePath()))android.os.Process.killProcess(pid);
        }catch(Exception ignored){}
    }
}
