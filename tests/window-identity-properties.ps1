param([long]$WindowHandle)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Read native window/taskbar metadata only; never alter windows or shell settings.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FacetWindowIdentityProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Key {public Guid fmtid; public uint pid;}
 [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value {[FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer;}
 [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface Store {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index, out Key key);
  [PreserveSig] int GetValue(ref Key key, out Value value);
  [PreserveSig] int SetValue(ref Key key, ref Value value);
  [PreserveSig] int Commit();
 }
 [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out Store store);
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
 [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,UIntPtr wparam,IntPtr lparam,uint flags,uint timeout,out UIntPtr value);
 [DllImport("user32.dll",EntryPoint="GetClassLongPtrW")] static extern IntPtr GetClassLongPtr(IntPtr hwnd,int index);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 public static uint Owner(long hwnd) {uint pid;GetWindowThreadProcessId(new IntPtr(hwnd),out pid);return pid;}
 public static long Icon(long hwnd, bool small) {UIntPtr value;SendMessageTimeout(new IntPtr(hwnd),0x7f,new UIntPtr(small?0u:1u),IntPtr.Zero,2,2000,out value);return value!=UIntPtr.Zero?(long)value.ToUInt64():GetClassLongPtr(new IntPtr(hwnd),small?-34:-14).ToInt64();}
 public static string Read(long hwnd, uint pid) {
  var iid=typeof(Store).GUID; Store store; Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(new IntPtr(hwnd),ref iid,out store));
  try {var key=new Key{fmtid=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),pid=pid};Value v;Marshal.ThrowExceptionForHR(store.GetValue(ref key,out v));try{return v.vt==31?Marshal.PtrToStringUni(v.pointer):null;}finally{PropVariantClear(ref v);}}
  finally{Marshal.ReleaseComObject(store);}
 }
}
'@
Add-Type -AssemblyName System.Drawing
function BitmapHash($bitmap) {
 $stream = [System.IO.MemoryStream]::new()
 $hash = [System.Security.Cryptography.SHA256]::Create()
 try { $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png); return [Convert]::ToHexString($hash.ComputeHash($stream.ToArray())) }
 finally { $stream.Dispose(); $hash.Dispose() }
}
function IconDetails([bool]$small) {
 $handle = [FacetWindowIdentityProbe]::Icon($WindowHandle,$small)
 if($handle -eq 0) { return $null }
 $bitmap = [System.Drawing.Icon]::FromHandle([IntPtr]$handle).ToBitmap()
 try { return @{width=$bitmap.Width;height=$bitmap.Height;hash=(BitmapHash $bitmap)} }
 finally { $bitmap.Dispose() }
}
[ordered]@{handle=$WindowHandle;pid=[FacetWindowIdentityProbe]::Owner($WindowHandle);appId=[FacetWindowIdentityProbe]::Read($WindowHandle,5);icon=[FacetWindowIdentityProbe]::Read($WindowHandle,3);command=[FacetWindowIdentityProbe]::Read($WindowHandle,2);name=[FacetWindowIdentityProbe]::Read($WindowHandle,4);large=(IconDetails $false);small=(IconDetails $true)} | ConvertTo-Json -Compress -Depth 4
