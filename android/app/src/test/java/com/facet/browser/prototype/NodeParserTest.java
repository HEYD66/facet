package com.facet.browser.prototype;
import org.junit.Test;
import org.json.*;
import static org.junit.Assert.*;
import java.util.*;
import java.nio.charset.StandardCharsets;

public class NodeParserTest {
    @Test public void yamlReadsOnlyNodesAndNeverAppliesRouting() throws Exception {
        JSONObject node=NodeParser.parse("mixed-port: 9\ndns: {enable: true}\ntun: {enable: true}\nrules: [MATCH,DIRECT]\nproxies:\n - {name: Fixture, type: http, server: 127.0.0.1, port: 12345, arbitrary: ignored}\n").get(0);
        assertEquals(12345,node.getInt("port"));assertFalse(node.has("arbitrary"));assertFalse(node.has("rules"));assertFalse(node.has("tun"));
    }
    @Test public void supportsJsonAndBase64Subscriptions() throws Exception {
        String pass=UUID.randomUUID().toString();String ss="ss://"+Base64.getUrlEncoder().withoutPadding().encodeToString(("aes-128-gcm:"+pass).getBytes(StandardCharsets.UTF_8))+"@127.0.0.1:443#test";
        assertEquals(pass,NodeParser.parse(ss).get(0).getString("password"));
        assertEquals("ss",NodeParser.parse(Base64.getEncoder().encodeToString(ss.getBytes(StandardCharsets.UTF_8))).get(0).getString("type"));
        String json=new JSONObject().put("proxies",new JSONArray().put(NodeParser.parse(ss).get(0))).toString();assertEquals("ss",NodeParser.parse(json).get(0).getString("type"));
    }
    @Test public void transportAndRealityFieldsRemainCoherent() throws Exception {
        JSONObject n=NodeParser.parse("vless://"+UUID.randomUUID()+"@example.com:443?security=reality&pbk=fixture-public-key&sid=ab&fp=chrome&type=grpc&serviceName=service#Fixture").get(0);
        assertTrue(n.getBoolean("tls"));assertEquals("grpc",n.getString("network"));assertEquals("fixture-public-key",n.getJSONObject("reality-opts").getString("public-key"));assertEquals("service",n.getJSONObject("grpc-opts").getString("grpc-service-name"));
        JSONObject h=NodeParser.parse("hy2://"+UUID.randomUUID()+"@example.com:8443?sni=example.com&obfs=salamander&obfs-password=fixture#Hy2").get(0);assertEquals("hysteria2",h.getString("type"));assertEquals(8443,h.getInt("port"));
    }
    @Test public void rejectsBadOrExecutableConfigurations() {
        for(String bad:Arrays.asList("<html>login</html>","proxies: []","!!javax.script.ScriptEngineManager []","proxies: [{type: http, server: localhost, port: 0}]","proxies: [{type: ss, server: localhost, port: 443, plugin: executable}]","vless://id@example.com:443?type=xhttp")){
            assertThrows(Exception.class,()->NodeParser.parse(bad));
        }
    }
    @Test public void vmessWebsocketAndIpv6SsAreParsed() throws Exception {
        String payload=new JSONObject().put("ps","vmess test").put("add","example.com").put("port","443").put("id",UUID.randomUUID()).put("net","ws").put("tls","tls").put("host","example.com").put("path","/ws").toString();
        JSONObject v=NodeParser.parse("vmess://"+Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8))).get(0);assertTrue(v.getBoolean("tls"));assertEquals("/ws",v.getJSONObject("ws-opts").getString("path"));
        JSONObject ss=NodeParser.parse("ss://aes-128-gcm:fixture@[::1]:1234#IPv6").get(0);assertEquals(1234,ss.getInt("port"));assertEquals("::1",ss.getString("server"));
    }
    @Test public void enforcesLimitsAndDuplicateYamlKeys() {
        assertThrows(Exception.class,()->NodeParser.parse("x".repeat(NodeParser.LIMIT+1)));
        assertThrows(Exception.class,()->NodeParser.parse("proxies: []\nproxies: []"));
    }
}
