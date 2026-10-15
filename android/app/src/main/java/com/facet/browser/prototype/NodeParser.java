package com.facet.browser.prototype;

import org.json.*;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Reads node data only. Subscription DNS, scripts, providers and rules are never applied. */
public final class NodeParser {
    public static final int LIMIT=2*1024*1024, MAX_NODES=500;
    private static final Set<String> TYPES=new HashSet<>(Arrays.asList("http","socks5","ss","vmess","vless","trojan","hysteria2","tuic","anytls"));
    private static final Set<String> FIELDS=new HashSet<>(Arrays.asList("name","type","server","port","username","password","cipher","uuid","alterId","security","udp","tls","servername","sni","skip-cert-verify","client-fingerprint","fingerprint","network","ws-opts","grpc-opts","http-opts","h2-opts","reality-opts","packet-encoding","flow","alpn","obfs","obfs-password","up","down","congestion-controller","udp-relay-mode","reduce-rtt","disable-sni","heartbeat-interval","ip-version"));
    private NodeParser() {}
    public static List<JSONObject> parse(String text) throws Exception {
        if(text==null||text.length()>LIMIT||text.getBytes(StandardCharsets.UTF_8).length>LIMIT)throw new Exception("导入内容超过 2 MiB");text=text.trim();if(text.isEmpty())throw new Exception("请输入节点或配置");
        if(text.startsWith("<"))throw new Exception("服务器返回网页，没有节点配置");
        if(!text.contains("://")&&!text.contains("proxies")){try{text=new String(decode(text),StandardCharsets.UTF_8).trim();}catch(IllegalArgumentException ignored){}}
        List<JSONObject> result=new ArrayList<>();
        if(text.startsWith("{")||text.startsWith("[")||text.matches("(?s).*\\bproxies\\s*:.*")){
            LoaderOptions options=new LoaderOptions();options.setAllowDuplicateKeys(false);options.setMaxAliasesForCollections(10);options.setNestingDepthLimit(25);options.setCodePointLimit(LIMIT);
            Object root;try{root=new Yaml(new SafeConstructor(options)).load(text);}catch(Exception e){throw new Exception("配置格式错误，请检查 YAML / JSON");}
            Object nodes=root instanceof Map?((Map<?,?>)root).get("proxies"):root;
            if(!(nodes instanceof List))throw new Exception("配置缺少 proxies 节点列表");
            if(((List<?>)nodes).size()>MAX_NODES)throw new Exception("单次最多导入 500 个节点");
            for(Object raw:(List<?>)nodes){if(!(raw instanceof Map))throw new Exception("节点配置不是对象");result.add(validate(new JSONObject((Map<?,?>)raw)));}
        } else {
            String[] lines=text.split("\\r?\\n");if(lines.length>MAX_NODES)throw new Exception("单次最多导入 500 个节点");
            for(String line:lines)if(!line.trim().isEmpty())result.add(validate(link(line.trim())));
        }
        if(result.isEmpty())throw new Exception("订阅中没有可导入节点");return result;
    }
    public static JSONObject validate(JSONObject input) throws Exception {
        String type=input.optString("type").toLowerCase(Locale.ROOT);if(!TYPES.contains(type))throw new Exception("存在暂不支持的节点协议");
        String host=input.optString("server").trim();if(host.startsWith("[")&&host.endsWith("]"))host=host.substring(1,host.length()-1);int port=input.optInt("port",0);if(host.isEmpty()||host.length()>253||host.matches(".*[\\s/\\\\].*")||port<1||port>65535)throw new Exception("节点地址或端口无效");
        if(input.has("plugin")||input.has("dialer-proxy"))throw new Exception("暂不支持外部插件或链式节点");
        JSONObject node=new JSONObject();for(Iterator<String> it=input.keys();it.hasNext();){String key=it.next();if(FIELDS.contains(key))node.put(key,input.get(key));}
        node.put("type",type);node.put("server",host);node.put("port",port);String name=input.optString("name",type+" 节点").replaceAll("[\\p{Cntrl}]", " ");node.put("name",name.substring(0,Math.min(name.length(),100)));return node;
    }
    private static byte[] decode(String value){String t=value.replaceAll("\\s","").replace('-','+').replace('_','/');return Base64.getDecoder().decode(t);}
    private static String dec(String value) throws Exception {return URLDecoder.decode(value.replace("+","%2B"),"UTF-8");}
    private static JSONObject link(String link) throws Exception {
        if(link.startsWith("vmess://")){JSONObject raw;try{raw=new JSONObject(new String(decode(link.substring(8)),StandardCharsets.UTF_8));}catch(Exception e){throw new Exception("VMess 链接格式错误");}JSONObject n=new JSONObject();n.put("name",raw.optString("ps","VMess"));n.put("type","vmess");n.put("server",raw.optString("add"));n.put("port",raw.optInt("port"));n.put("uuid",raw.optString("id"));n.put("alterId",raw.optInt("aid",0));n.put("cipher",raw.optString("scy","auto"));n.put("tls","tls".equals(raw.optString("tls")));if(!raw.optString("sni").isEmpty())n.put("servername",raw.getString("sni"));String net=raw.optString("net","tcp");if(!net.equals("tcp")){n.put("network",net);if(net.equals("ws")){JSONObject opts=new JSONObject();opts.put("path",raw.optString("path","/"));if(!raw.optString("host").isEmpty())opts.put("headers",new JSONObject().put("Host",raw.getString("host")));n.put("ws-opts",opts);}else if(net.equals("grpc"))n.put("grpc-opts",new JSONObject().put("grpc-service-name",raw.optString("path")));else throw new Exception("暂不支持此 VMess 传输方式");}return n;}
        if(link.startsWith("ss://")){
            String value=link.substring(5),name="Shadowsocks";int mark=value.indexOf('#');if(mark>=0){name=dec(value.substring(mark+1));value=value.substring(0,mark);}if(value.contains("?"))throw new Exception("带插件参数的 SS 链接请使用 YAML 配置");
            if(!value.contains("@"))value=new String(decode(value),StandardCharsets.UTF_8);int at=value.lastIndexOf('@');if(at<1)throw new Exception("SS 链接格式错误");String user=value.substring(0,at);if(!user.contains(":"))user=new String(decode(user),StandardCharsets.UTF_8);int colon=user.indexOf(':');if(colon<1)throw new Exception("SS 链接缺少加密信息");URI endpoint=new URI("ss://"+value.substring(at+1));return new JSONObject().put("name",name).put("type","ss").put("server",endpoint.getHost()).put("port",endpoint.getPort()).put("cipher",dec(user.substring(0,colon))).put("password",dec(user.substring(colon+1)));
        }
        URI uri;try{uri=new URI(link);}catch(Exception e){throw new Exception("节点链接格式错误");}String type=uri.getScheme();if(type==null)throw new Exception("无法识别节点格式");type=type.toLowerCase(Locale.ROOT);if(type.equals("hy2"))type="hysteria2";
        if(!Arrays.asList("vless","trojan","hysteria2","tuic","anytls","socks5").contains(type))throw new Exception("链接协议不支持，请使用 proxies 配置");
        JSONObject n=new JSONObject().put("type",type).put("server",uri.getHost()).put("port",uri.getPort()>0?uri.getPort():443).put("name",uri.getRawFragment()==null?type:dec(uri.getRawFragment()));String user=uri.getRawUserInfo();if(user==null&& !type.equals("socks5"))throw new Exception("节点链接缺少认证信息");user=user==null?"":dec(user);
        Map<String,String> q=new HashMap<>();if(uri.getRawQuery()!=null)for(String part:uri.getRawQuery().split("&")){String[] kv=part.split("=",2);q.put(dec(kv[0]),kv.length==2?dec(kv[1]):"");}
        if(type.equals("vless")){n.put("uuid",user);if(q.containsKey("flow"))n.put("flow",q.get("flow"));}
        else if(type.equals("tuic")){String[] pair=user.split(":",2);if(pair.length!=2)throw new Exception("TUIC 链接缺少密码");n.put("uuid",pair[0]).put("password",pair[1]);}
        else if(type.equals("socks5")){if(!user.isEmpty()){String[] pair=user.split(":",2);n.put("username",pair[0]);n.put("password",pair.length>1?pair[1]:"");}}
        else n.put("password",user);
        String sni=q.getOrDefault("sni",q.get("peer"));if(sni!=null)n.put(type.equals("vless")?"servername":"sni",sni);if(q.containsKey("insecure"))n.put("skip-cert-verify",q.get("insecure").equals("1"));if(q.containsKey("alpn"))n.put("alpn",new JSONArray(Arrays.asList(q.get("alpn").split(","))));if(q.containsKey("fp"))n.put("client-fingerprint",q.get("fp"));
        String security=q.getOrDefault("security",type.equals("vless")?"none":"tls");if(security.equals("reality")){if(!q.containsKey("pbk"))throw new Exception("Reality 链接缺少公钥");n.put("reality-opts",new JSONObject().put("public-key",q.get("pbk")).put("short-id",q.getOrDefault("sid","")));}if(type.equals("vless"))n.put("tls",!security.equals("none"));
        String net=q.getOrDefault("type","tcp");if(!net.equals("tcp")){if(net.equals("ws")){n.put("network","ws");JSONObject opts=new JSONObject().put("path",q.getOrDefault("path","/"));if(q.containsKey("host"))opts.put("headers",new JSONObject().put("Host",q.get("host")));n.put("ws-opts",opts);}else if(net.equals("grpc"))n.put("network","grpc").put("grpc-opts",new JSONObject().put("grpc-service-name",q.getOrDefault("serviceName","")));else throw new Exception("暂不支持此传输方式");}
        for(String key:Arrays.asList("obfs","obfs-password","congestion-controller"))if(q.containsKey(key))n.put(key,q.get(key));return n;
    }
}
