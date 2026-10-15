package com.facet.browser.prototype;

import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

public final class SubscriptionDownload {
    private SubscriptionDownload() {}
    public static String fetch(String address,Proxy route) throws Exception {
        URL url;try{url=new URL(address.trim());}catch(Exception e){throw new Exception("订阅地址格式错误");}
        for(int redirects=0;redirects<=5;redirects++){
            if(!(url.getProtocol().equals("http")||url.getProtocol().equals("https"))||url.getHost().isEmpty()||url.getUserInfo()!=null||url.getRef()!=null)throw new Exception("请输入 HTTP / HTTPS 订阅地址");
            HttpURLConnection c=(HttpURLConnection)url.openConnection(route);c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(15000);c.setRequestProperty("User-Agent","ClashMeta/v1.19.31 (Android; Facet)");c.setRequestProperty("Accept-Encoding","gzip");
            try{int code=c.getResponseCode();if(code>=300&&code<=399){String location=c.getHeaderField("Location");if(location==null)throw new Exception("订阅重定向缺少地址");URL next=new URL(url,location);if(url.getProtocol().equals("https")&&!next.getProtocol().equals("https"))throw new Exception("订阅从 HTTPS 降级，已拒绝下载");url=next;continue;}
                if(code!=200)throw new Exception("订阅服务器返回 HTTP "+code);if(c.getContentLengthLong()>NodeParser.LIMIT)throw new Exception("订阅超过 2 MiB");
                try(InputStream raw=c.getInputStream();InputStream stream="gzip".equalsIgnoreCase(c.getContentEncoding())?new GZIPInputStream(raw):raw;ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1){if(out.size()+count>NodeParser.LIMIT)throw new Exception("订阅解压后超过 2 MiB");out.write(buffer,0,count);}return out.toString(StandardCharsets.UTF_8.name());
                }
            }catch(java.net.SocketTimeoutException e){throw new Exception("订阅下载超时，请更换下载网络或检查服务");}catch(javax.net.ssl.SSLException e){throw new Exception("订阅 TLS / 证书验证失败");}catch(IOException e){throw new Exception("订阅网络连接失败，未自动切换其他网络");}finally{c.disconnect();}
        }
        throw new Exception("订阅重定向超过 5 次");
    }
}
