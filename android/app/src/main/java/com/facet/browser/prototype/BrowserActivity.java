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
import org.json.*;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.net.Proxy;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public abstract class BrowserActivity extends Activity {
    protected abstract int profile();
    private WebView web;
    private TextView status;
    private EditText address;
    private SharedPreferences prefs;
    private String proxy;
    private boolean ready;
    private boolean loadError;
    private volatile boolean destroyed;
    private AtomicInteger importing;
    private CoreEngine engine;
    private String activeProxy="";
    private int generation;
    private final ExecutorService work=Executors.newSingleThreadExecutor();
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs=getSharedPreferences("profile"+profile(),MODE_PRIVATE); proxy=prefs.getString("proxy","");
        engine=new CoreEngine(this,profile(),message->runOnUiThread(()->{if(!destroyed){ready=false;web.getSettings().setBlockNetworkLoads(true);status.setText(message);}}));
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);
        LinearLayout tools=new LinearLayout(this);
        Button home=new Button(this);home.setText("实例 "+profile());home.setOnClickListener(v->finish());tools.addView(home);
        Button refresh=new Button(this);refresh.setText("刷新");refresh.setOnClickListener(v->{if(ready)web.reload();});tools.addView(refresh);
        Button network=new Button(this);network.setText("代理");network.setOnClickListener(v->networkDialog());tools.addView(network);box.addView(tools);
        Button nodes=new Button(this);nodes.setText("节点");nodes.setOnClickListener(v->nodeDialog());tools.addView(nodes);
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
    private String networkLabel(){return prefs.getBoolean("useCore",false)?"Mihomo · "+prefs.getString("nodeName","节点"):proxy.isEmpty()?"系统网络":"指定代理";}
    private void navigate(){if(!ready)return;String url=address.getText().toString().trim();if(!url.contains("://"))url="https://"+url;Uri u=Uri.parse(url);if(!("http".equals(u.getScheme())||"https".equals(u.getScheme()))||u.getHost()==null){status.setText("请输入 HTTP 或 HTTPS 网址");return;}web.loadUrl(url);}
    private void applyProxy(){
        ready=false;web.stopLoading();web.getSettings().setBlockNetworkLoads(true);status.setText("正在配置 · "+networkLabel());final int request=++generation;final boolean useCore=prefs.getBoolean("useCore",false);final String manual=proxy,selected=prefs.getString("nodeJson","");
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)&&(useCore||!proxy.isEmpty())){status.setText("当前 WebView 不支持指定代理，请更新系统 WebView");return;}
        work.execute(()->{try{engine.stop();String endpoint=useCore?"http://127.0.0.1:"+engine.start(new JSONObject(selected)):manual;runOnUiThread(()->{if(destroyed||request!=generation)return;Runnable done=()->{if(destroyed||request!=generation)return;activeProxy=endpoint;ready=true;web.getSettings().setBlockNetworkLoads(false);status.setText("网络设置已应用 · "+networkLabel());navigate();};try{if(!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)){done.run();return;}if(endpoint.isEmpty())ProxyController.getInstance().clearProxyOverride(this::runOnUiThread,done);else ProxyController.getInstance().setProxyOverride(new ProxyConfig.Builder().addProxyRule(endpoint).removeImplicitRules().build(),this::runOnUiThread,done);}catch(IllegalArgumentException|UnsupportedOperationException e){status.setText("代理设置失败，已阻止页面加载");}});}catch(Exception e){runOnUiThread(()->{if(!destroyed&&request==generation)status.setText("网络未启用："+safe(e));});}});
    }
    private void networkDialog(){
        EditText input=new EditText(this);input.setSingleLine();input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);input.setText(proxy);input.setHint("http://主机:端口 或 socks5://主机:端口");
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("实例 "+profile()+" · 独立代理").setMessage("留空使用系统网络。需账号密码或其他节点协议，请从“节点”导入配置。127.0.0.1 指手机本身。").setView(input).setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(x->{String val=input.getText().toString().trim();if(!val.isEmpty()){Uri u=Uri.parse(val);if(!("http".equals(u.getScheme())||"socks5".equals(u.getScheme()))||u.getHost()==null||u.getPort()<1||u.getPort()>65535||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||(u.getPath()!=null&&!u.getPath().isEmpty())){input.setError("请输入有效的无认证 HTTP/SOCKS5 代理地址");return;}}web.stopLoading();proxy=val;prefs.edit().putString("proxy",proxy).putBoolean("useCore",false).apply();applyProxy();dialog.dismiss();}));dialog.show();
    }
    private String safe(Exception e){return e.getClass()==Exception.class&&e.getMessage()!=null?e.getMessage():"操作失败，配置已保留，请检查格式或内核记录";}
    private File nodesFile(){return new File(getFilesDir(),"profile"+profile()+"-nodes.json");}
    private JSONArray loadNodes() throws Exception {return nodesFile().exists()?new JSONArray(new String(Files.readAllBytes(nodesFile().toPath()),StandardCharsets.UTF_8)):new JSONArray();}
    private boolean addNodes(String content,AtomicInteger state) throws Exception {List<JSONObject> incoming=NodeParser.parse(content);JSONArray old=loadNodes();if(old.length()+incoming.size()>NodeParser.MAX_NODES)throw new Exception("节点库最多保存 500 个节点");for(JSONObject node:incoming)old.put(node);if(destroyed||!state.compareAndSet(0,2))return false;CoreEngine.write(nodesFile(),old.toString());return true;}
    private void nodeDialog(){
        try{JSONArray library=loadNodes();String[] choices=new String[library.length()+3];choices[0]="导入节点 / Clash 配置";choices[1]="下载订阅";choices[2]="查看内核记录";for(int i=0;i<library.length();i++)choices[i+3]=library.getJSONObject(i).optString("name")+" · "+library.getJSONObject(i).optString("type");
            new AlertDialog.Builder(this).setTitle("实例 "+profile()+" · 节点库").setItems(choices,(d,index)->{if(index==0){importDialog(false);return;}if(index==1){importDialog(true);return;}if(index==2){new AlertDialog.Builder(this).setTitle("内核阶段记录（不含凭据）").setMessage(engine.diagnostic()).setPositiveButton("关闭",null).show();return;}try{JSONObject node=library.getJSONObject(index-3);prefs.edit().putString("nodeJson",node.toString()).putString("nodeName",node.optString("name")).putBoolean("useCore",true).apply();applyProxy();}catch(Exception e){status.setText(safe(e));}}).setNegativeButton("关闭",null).show();
        }catch(Exception e){status.setText("节点库读取失败，原文件已保留");}
    }
    private void importDialog(boolean subscription){
        AtomicInteger state=new AtomicInteger(0);importing=state;
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(24,12,24,12);EditText input=new EditText(this);input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);input.setMinLines(subscription?1:4);input.setMaxLines(8);input.setHint(subscription?"HTTP / HTTPS 订阅链接":"ss://、vmess://、vless://… 或含 proxies 的 YAML / JSON");box.addView(input);
        RadioGroup routes=new RadioGroup(this);RadioButton system=new RadioButton(this);system.setId(R.id.download_system);system.setText("系统网络（仍受手机 VPN 影响）");routes.addView(system);RadioButton current=new RadioButton(this);current.setId(R.id.download_instance);current.setText("当前实例代理");routes.addView(current);routes.check(R.id.download_system);if(subscription)box.addView(routes);
        Runnable cancel=()->{if(state.compareAndSet(0,1))status.setText("已取消导入，原节点库保留");else if(state.get()==2)status.setText("节点已进入保存阶段，完成后关闭");};
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(subscription?"下载并导入订阅":"导入到当前实例节点库").setView(box).setNegativeButton("取消",(d,which)->cancel.run()).setPositiveButton(subscription?"下载":"导入",null).create();dialog.setOnCancelListener(d->cancel.run());
        dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(x->{String content=input.getText().toString().trim();if(content.isEmpty()){input.setError("请输入内容");return;}Proxy route=Proxy.NO_PROXY;if(subscription&&routes.getCheckedRadioButtonId()==R.id.download_instance){if(!ready||activeProxy.isEmpty()){input.setError("当前实例没有已启用的代理");return;}try{URI uri=new URI(activeProxy);route=new Proxy(uri.getScheme().equals("socks5")?Proxy.Type.SOCKS:Proxy.Type.HTTP,new InetSocketAddress(uri.getHost(),uri.getPort()));}catch(Exception e){input.setError("当前代理不支持订阅下载");return;}}
            final Proxy downloadRoute=route;dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);input.setEnabled(false);status.setText(subscription?"正在下载订阅…":"正在解析节点…");work.execute(()->{try{if(!addNodes(subscription?SubscriptionDownload.fetch(content,downloadRoute):content,state))return;runOnUiThread(()->{if(!destroyed){status.setText("节点已保存，请在节点库中选择启用");boolean visible=dialog.isShowing();dialog.dismiss();if(visible)nodeDialog();}});}catch(Exception e){runOnUiThread(()->{if(!destroyed&&state.get()!=1&&dialog.isShowing()){state.set(0);status.setText(safe(e));input.setEnabled(true);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);}});}});
        }));dialog.show();
    }
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){destroyed=true;if(importing!=null)importing.compareAndSet(0,1);generation++;web.stopLoading();CookieManager.getInstance().flush();web.destroy();work.execute(()->{try{engine.stop();}catch(Exception ignored){}});work.shutdown();super.onDestroy();}
}
