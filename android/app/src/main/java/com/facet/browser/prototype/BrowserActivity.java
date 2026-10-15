package com.facet.browser.prototype;

import android.app.*;
import android.os.Bundle;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.view.inputmethod.EditorInfo;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.*;

public abstract class BrowserActivity extends Activity {
    protected abstract int profile();
    private WebView web;
    private TextView status;
    private EditText address;
    private SharedPreferences prefs;
    private String proxy;
    private boolean ready;
    private boolean loadError;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs=getSharedPreferences("profile"+profile(),MODE_PRIVATE); proxy=prefs.getString("proxy","");
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);
        LinearLayout tools=new LinearLayout(this);
        Button home=new Button(this);home.setText("实例 "+profile());home.setOnClickListener(v->finish());tools.addView(home);
        Button refresh=new Button(this);refresh.setText("刷新");refresh.setOnClickListener(v->{if(ready)web.reload();});tools.addView(refresh);
        Button network=new Button(this);network.setText("代理");network.setOnClickListener(v->networkDialog());tools.addView(network);box.addView(tools);
        address=new EditText(this);address.setSingleLine();address.setText(prefs.getString("url","https://example.com"));address.setInputType(17);address.setImeOptions(EditorInfo.IME_ACTION_GO);address.setOnEditorActionListener((v,a,e)->{if(a==EditorInfo.IME_ACTION_GO){navigate();return true;}return false;});box.addView(address);
        Button go=new Button(this);go.setText("前往");go.setOnClickListener(v->navigate());box.addView(go);
        status=new TextView(this);box.addView(status);
        web=new WebView(this);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE)!=0)WebView.setWebContentsDebuggingEnabled(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){String s=request.getUrl().getScheme();return !("https".equals(s)||"http".equals(s));}
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){loadError=false;status.setText("正在加载 · "+networkLabel());}
            @Override public void onPageFinished(WebView view,String url){if(!loadError)status.setText("加载结束 · "+networkLabel());address.setText(url);prefs.edit().putString("url",url).apply();CookieManager.getInstance().flush();}
            @Override public void onReceivedError(WebView view,WebResourceRequest req,WebResourceError error){if(req.isForMainFrame()){loadError=true;status.setText("加载失败："+error.getErrorCode()+" · "+error.getDescription());}}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest req,WebResourceResponse response){if(req.isForMainFrame()){loadError=true;status.setText("网站返回 HTTP "+response.getStatusCode());}}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();loadError=true;status.setText("证书验证失败，已取消连接");}
        });
        web.setWebChromeClient(new WebChromeClient());box.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(box);applyProxy();
    }
    private String networkLabel(){return proxy.isEmpty()?"系统网络":"指定代理";}
    private void navigate(){if(!ready)return;String url=address.getText().toString().trim();if(!url.contains("://"))url="https://"+url;Uri u=Uri.parse(url);if(!("http".equals(u.getScheme())||"https".equals(u.getScheme()))||u.getHost()==null){status.setText("请输入 HTTP 或 HTTPS 网址");return;}web.loadUrl(url);}
    private void applyProxy(){
        ready=false;status.setText("正在配置 · "+networkLabel());
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)){if(!proxy.isEmpty()){status.setText("当前 WebView 不支持指定代理，请更新系统 WebView");return;}ready=true;navigate();return;}
        Runnable done=()->{ready=true;status.setText("网络设置已应用 · "+networkLabel());navigate();};
        try{if(proxy.isEmpty())ProxyController.getInstance().clearProxyOverride(this::runOnUiThread,done);
        else ProxyController.getInstance().setProxyOverride(new ProxyConfig.Builder().addProxyRule(proxy).removeImplicitRules().build(),this::runOnUiThread,done);}
        catch(IllegalArgumentException|UnsupportedOperationException e){status.setText("代理设置失败，已阻止页面加载");}
    }
    private void networkDialog(){
        EditText input=new EditText(this);input.setSingleLine();input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);input.setText(proxy);input.setHint("http://主机:端口 或 socks5://主机:端口");
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("实例 "+profile()+" · 独立代理").setMessage("留空使用系统网络。验证版暂不支持密码认证、订阅和节点协议。127.0.0.1 指手机本身。").setView(input).setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(x->{String val=input.getText().toString().trim();if(!val.isEmpty()){Uri u=Uri.parse(val);if(!("http".equals(u.getScheme())||"socks5".equals(u.getScheme()))||u.getHost()==null||u.getPort()<1||u.getPort()>65535||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||(u.getPath()!=null&&!u.getPath().isEmpty())){input.setError("请输入有效的无认证 HTTP/SOCKS5 代理地址");return;}}web.stopLoading();proxy=val;prefs.edit().putString("proxy",proxy).apply();applyProxy();dialog.dismiss();}));dialog.show();
    }
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){web.stopLoading();CookieManager.getInstance().flush();web.destroy();super.onDestroy();}
}
