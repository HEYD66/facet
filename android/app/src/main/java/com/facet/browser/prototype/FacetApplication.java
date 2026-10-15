package com.facet.browser.prototype;

import android.app.Application;
import android.webkit.WebView;

public class FacetApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        String process = Application.getProcessName();
        if (process.endsWith(":profile1")) WebView.setDataDirectorySuffix("profile1");
        else if (process.endsWith(":profile2")) WebView.setDataDirectorySuffix("profile2");
        else WebView.disableWebView();
    }
}
