'use strict';
const {ipcRenderer}=require('electron');
let dragging=false;
window.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=true;try{event.target.setPointerCapture(event.pointerId);}catch{}ipcRenderer.send('facet:devtools-resize',{type:'start'});event.preventDefault();});
window.addEventListener('pointermove',event=>{if(!dragging)return;ipcRenderer.send('facet:devtools-resize',{type:'move'});event.preventDefault();});
window.addEventListener('pointerup',event=>{if(!dragging)return;dragging=false;ipcRenderer.send('facet:devtools-resize',{type:'end'});event.preventDefault();});
window.addEventListener('pointercancel',()=>{if(dragging){dragging=false;ipcRenderer.send('facet:devtools-resize',{type:'end'});}});
