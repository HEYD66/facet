package com.facet.browser.prototype;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPOutputStream;

public class SubscriptionDownloadTest {
    private interface Response { byte[] bytes(); }
    private String request(Response response, Proxy route) throws Exception {
        try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){
            Thread worker=new Thread(()->{try(Socket client=server.accept()){client.setSoTimeout(5000);BufferedReader in=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.US_ASCII));String line;while((line=in.readLine())!=null&&!line.isEmpty()){}client.getOutputStream().write(response.bytes());}catch(IOException ignored){}});worker.setDaemon(true);worker.start();
            return SubscriptionDownload.fetch("http://127.0.0.1:"+server.getLocalPort()+"/subscription",route);
        }
    }
    @Test public void readsActualHttpResponse() throws Exception {assertEquals("proxies: []",request(()->"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nproxies: []".getBytes(StandardCharsets.UTF_8),Proxy.NO_PROXY));}
    @Test public void rejectsHttpErrorsAndOversizeBeforeParsing() {
        assertThrows(Exception.class,()->request(()->"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8),Proxy.NO_PROXY));
        assertThrows(Exception.class,()->request(()->"HTTP/1.1 200 OK\r\nContent-Length: 9999999\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8),Proxy.NO_PROXY));
    }
    @Test public void decompressesGzipWithBoundedOutput() throws Exception {
        ByteArrayOutputStream zipped=new ByteArrayOutputStream();try(GZIPOutputStream gzip=new GZIPOutputStream(zipped)){gzip.write("proxies: []".getBytes(StandardCharsets.UTF_8));}
        ByteArrayOutputStream response=new ByteArrayOutputStream();response.write(("HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: "+zipped.size()+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));response.write(zipped.toByteArray());assertEquals("proxies: []",request(response::toByteArray,Proxy.NO_PROXY));
    }
    @Test public void chosenBrokenProxyDoesNotRetryDirect() throws Exception {
        int dead;try(ServerSocket socket=new ServerSocket(0)){dead=socket.getLocalPort();}
        Proxy broken=new Proxy(Proxy.Type.HTTP,new InetSocketAddress("127.0.0.1",dead));try(ServerSocket origin=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){origin.setSoTimeout(200);assertThrows(Exception.class,()->SubscriptionDownload.fetch("http://127.0.0.1:"+origin.getLocalPort()+"/subscription",broken));assertThrows(SocketTimeoutException.class,origin::accept);}
    }
}
