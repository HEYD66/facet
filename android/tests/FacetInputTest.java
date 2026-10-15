package com.facet.test;

import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

// ADB-only UI helper. Does not become part of the product APK or change the IME.
public class FacetInputTest extends UiAutomatorTestCase {
    static class Field extends UiObject {
        Field() { super(new UiSelector().packageName("com.facet.browser.prototype").className("android.widget.EditText")); }
        AccessibilityNodeInfo node() { return findAccessibilityNodeInfo(5000); }
    }
    public void testSetText() {
        AccessibilityNodeInfo node = new Field().node();
        assertNotNull(node);
        Bundle args = new Bundle();
        String value=getParams().getString("text", "");
        if(getParams().containsKey("base64"))value=new String(android.util.Base64.decode(getParams().getString("base64"),android.util.Base64.DEFAULT),java.nio.charset.StandardCharsets.UTF_8);
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,value);
        assertTrue(node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args));
    }
}
