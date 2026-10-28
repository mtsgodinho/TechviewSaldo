import type {Metadata,Viewport} from 'next';
import './globals.css';
export const metadata:Metadata={title:'TECHVIEW SALDO | Gestão de saldo',description:'Seu saldo de anúncios, com clareza e controle.',appleWebApp:{capable:true,title:'TechView',statusBarStyle:'black-translucent'},icons:{icon:'/icons/techview-192.png?v=1.2',apple:'/icons/techview-180.png?v=1.2'}};
export const viewport:Viewport={themeColor:'#080b12'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
