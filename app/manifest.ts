import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {
 id:'/',name:'TechView Saldo',short_name:'TechView',lang:'pt-BR',description:'Seu saldo de anúncios, campanhas e mensalidades em um só lugar.',
 start_url:'/',scope:'/',display:'standalone',background_color:'#080b12',theme_color:'#080b12',prefer_related_applications:false,
 icons:[{src:'/icons/techview-192.png?v=1.2',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icons/techview-512.png?v=1.2',sizes:'512x512',type:'image/png',purpose:'any'}]
};}
