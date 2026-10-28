import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'TECHVIEW SALDO | Gestão de saldo',description:'Seu saldo de anúncios, com clareza e controle.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
