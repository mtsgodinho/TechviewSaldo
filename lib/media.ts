import sharp from 'sharp';
export const MEDIA_BUCKET='techview-profile-media';
export const MAX_MEDIA_BYTES=4*1024*1024;
export async function normalizeImage(bytes:Uint8Array,kind:'avatar'|'logo'){
 if(!bytes.length||bytes.length>MAX_MEDIA_BYTES)throw new Error('Envie uma imagem de até 4 MB');
 const pipeline=sharp(bytes,{limitInputPixels:16777216,animated:false});const meta=await pipeline.metadata();
 if(!meta.format||!['jpeg','png','webp'].includes(meta.format)||!meta.width||!meta.height||(meta.pages||1)>1)throw new Error('Use uma imagem estática JPG, PNG ou WebP');
 if(meta.width>4096||meta.height>4096)throw new Error('A imagem deve ter até 4096 × 4096 pixels');
 return pipeline.rotate().resize(kind==='avatar'?{width:512,height:512,fit:'cover'}:{width:1536,height:1024,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
}
