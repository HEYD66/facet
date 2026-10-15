package com.facet.browser.prototype;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.graphics.Color;
import android.widget.*;

public class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(32,48,32,24); box.setBackgroundColor(Color.rgb(248,246,241));
        TextView title = new TextView(this); title.setText("FACET 千面\n安卓架构验证版"); title.setTextSize(26); box.addView(title);
        TextView info = new TextView(this); info.setText("两个独立浏览实例，各自保存网站数据和代理设置。\n已接入独立 Mihomo、节点导入与订阅下载。环境指纹配置仍在开发。\n\n"); box.addView(info);
        add(box,"打开实例 1", ProfileOneActivity.class); add(box,"打开实例 2",ProfileTwoActivity.class);
        setContentView(box);
    }
    private void add(LinearLayout box,String text,Class<?> cls) { Button b = new Button(this); b.setText(text); b.setOnClickListener(v->startActivity(new Intent(this,cls).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))); box.addView(b); }
}
