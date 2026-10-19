'use strict';
const zlib=require('node:zlib');
function zip(entries){const local=[],central=[];let offset=0;for(const e of entries){const name=Buffer.from(e.name),data=Buffer.from(e.data||''),packed=zlib.deflateRawSync(data);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}crc=(crc^0xffffffff)>>>0;
 const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(e.flags||0,6);h.writeUInt16LE(8,8);h.writeUInt32LE(e.badCrc?0:crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(e.size??data.length,22);h.writeUInt16LE(name.length,26);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);h.copy(c,6,4,30);c.writeUInt32LE(e.attrs||0,38);c.writeUInt32LE(offset,42);local.push(h,name,packed);central.push(c,name);offset+=h.length+name.length+packed.length;
 }const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,cd,end]);}
module.exports={zip};
