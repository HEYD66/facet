package com.facet.browser.prototype;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** One loopback-only process and private configuration per browsing profile. */
public final class CoreEngine {
    private final File directory,binary,config,marker;
    private final Consumer<String> onFailure;
    private static CoreEngine owner;
    private volatile Process process;
    private volatile boolean expected;
    private volatile String issue="";
    private final Deque<String> history=new ArrayDeque<>();
    public CoreEngine(Context context,int profile,Consumer<String> callback){directory=new File(context.getFilesDir(),"core-profile"+profile);directory.mkdirs();binary=new File(context.getApplicationInfo().nativeLibraryDir,"libfacet_mihomo.so");config=new File(directory,"runtime.json");marker=new File(directory,"pid");onFailure=callback;}
    public static void write(File file,String value) throws IOException {AtomicFile out=new AtomicFile(file);FileOutputStream stream=null;try{stream=out.startWrite();stream.write(value.getBytes(StandardCharsets.UTF_8));out.finishWrite(stream);}catch(IOException e){if(stream!=null)out.failWrite(stream);throw e;}}
    private void record(String stage){synchronized(history){history.addLast(new Date()+" · "+stage);while(history.size()>100)history.removeFirst();try{write(new File(directory,"diagnostic.txt"),String.join("\n",history));}catch(IOException ignored){}}}
    public String diagnostic(){synchronized(history){return history.isEmpty()?"尚无内核记录":String.join("\n",history);}}
    public String issue(){return issue;}
    private static int port() throws IOException {try(ServerSocket s=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){return s.getLocalPort();}}
    private void reap() throws Exception {
        if(!marker.exists())return;int pid;try{pid=Integer.parseInt(new String(Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8).trim());}catch(Exception e){throw new Exception("内核进程记录异常，启动已停止");}
        File command=new File("/proc/"+pid+"/cmdline");if(command.exists()){
            String[] args;try{args=new String(Files.readAllBytes(command.toPath()),StandardCharsets.UTF_8).split("\u0000");}catch(IOException e){throw new Exception("无法核对上次内核进程，启动已停止");}
            if(args.length>0&&args[0].equals(binary.getAbsolutePath())&&Arrays.asList(args).contains(config.getAbsolutePath())){android.os.Process.killProcess(pid);for(int n=0;n<40&&command.exists();n++)Thread.sleep(50);if(command.exists())throw new Exception("上次内核尚未退出");}
        }
        if(!marker.delete())throw new IOException("无法清理旧内核记录");
    }
    public int start(JSONObject input) throws Exception {
        synchronized(CoreEngine.class){if(owner!=null&&owner!=this)owner.stopInternal();owner=this;return startInternal(input);}
    }
    private int startInternal(JSONObject input) throws Exception {
        stopInternal();reap();if(!binary.canExecute())throw new Exception("手机架构不支持或内置内核不可执行");issue="";expected=false;
        for(int attempt=0;attempt<3;attempt++){
            int proxy=port(),control=port();if(control==proxy){attempt--;continue;}
            byte[] key=new byte[32];new SecureRandom().nextBytes(key);String secret=Base64.getUrlEncoder().withoutPadding().encodeToString(key);
            JSONObject node=NodeParser.validate(input);node.put("name","facet-upstream");
            JSONObject settings=new JSONObject().put("mixed-port",proxy).put("bind-address","127.0.0.1").put("allow-lan",false).put("ipv6",true).put("mode","rule").put("log-level","warning").put("external-controller","127.0.0.1:"+control).put("secret",secret).put("dns",new JSONObject().put("enable",false)).put("tun",new JSONObject().put("enable",false)).put("profile",new JSONObject().put("store-selected",false).put("store-fake-ip",false)).put("proxies",new JSONArray().put(node)).put("rules",new JSONArray().put("MATCH,facet-upstream"));
            write(config,settings.toString());
            // Paths are separate argv values; no subscription string is shell code.
            process=new ProcessBuilder("/system/bin/sh","-c","echo $$ > \"$1\"; exec \"$2\" -d \"$3\" -f \"$4\"","facet-core",marker.getAbsolutePath(),binary.getAbsolutePath(),directory.getAbsolutePath(),config.getAbsolutePath()).redirectErrorStream(true).start();
            Process child=process;Thread output=new Thread(()->{try(BufferedReader reader=new BufferedReader(new InputStreamReader(child.getInputStream(),StandardCharsets.UTF_8))){String line;while((line=reader.readLine())!=null){String lower=line.toLowerCase(Locale.ROOT);String category=null;if(lower.contains("address already in use"))category="本地端口占用";else if(lower.contains("timeout"))category="节点连接超时";else if(lower.contains("certificate"))category="节点证书错误";else if(lower.contains("authentication")||lower.contains("unauthorized"))category="节点认证失败";else if(lower.contains("level=error")||lower.contains("level=fatal"))category="内核配置或运行错误";if(category!=null){issue=category;record(category);}}}catch(IOException ignored){}},"facet-core-output");output.setDaemon(true);output.start();
            record("正在启动独立内核");boolean live=false;
            for(int i=0;i<100;i++){if(!child.isAlive())break;try{HttpURLConnection connection=(HttpURLConnection)new URL("http://127.0.0.1:"+control+"/version").openConnection(Proxy.NO_PROXY);connection.setConnectTimeout(120);connection.setReadTimeout(120);connection.setRequestProperty("Authorization","Bearer "+secret);try{if(connection.getResponseCode()==200){ByteArrayOutputStream data=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] buffer=new byte[512];int count;while((count=in.read(buffer))!=-1){if(data.size()+count>4096)throw new IOException("version size");data.write(buffer,0,count);}}if(new JSONObject(data.toString("UTF-8")).optString("version").equals("v1.19.31")){try(Socket socket=new Socket()){socket.connect(new InetSocketAddress("127.0.0.1",proxy),120);live=true;}}}}finally{connection.disconnect();}}catch(Exception ignored){}if(live)break;Thread.sleep(50);}
            if(live){record("内核就绪 · 代理端口 "+proxy);Thread watcher=new Thread(()->{try{int code=child.waitFor();synchronized(CoreEngine.class){if(owner==CoreEngine.this&&process==child&&!expected){record("内核意外退出 · "+code);onFailure.accept("代理内核退出，已阻止加载；没有切换直连");}}}catch(InterruptedException e){Thread.currentThread().interrupt();}},"facet-core-watch");watcher.setDaemon(true);watcher.start();return proxy;}
            boolean retry=issue.equals("本地端口占用");stopInternal();if(!retry)throw new Exception(issue.isEmpty()?"内核启动失败，请检查节点参数":issue);expected=false;
        }
        throw new Exception("无法分配独立内核端口");
    }
    public void stop() throws Exception {synchronized(CoreEngine.class){if(owner!=null&&owner!=this)return;stopInternal();if(owner==this)owner=null;}}
    private void stopInternal() throws Exception {expected=true;Process child=process;if(child!=null){child.destroy();if(!child.waitFor(3,TimeUnit.SECONDS)){child.destroyForcibly();if(!child.waitFor(3,TimeUnit.SECONDS))throw new Exception("内核尚未停止");}process=null;record("内核已停止");}if(marker.exists())reap();if(config.exists()&&!config.delete())throw new IOException("无法清理内核临时配置");}
}
