'use client';
import {useEffect,useRef,useState} from 'react';
export default function BrandLogo({variant='menu',version=''}:{variant?:'menu'|'hero';version?:string}){
 const [loaded,setLoaded]=useState(false);const imageRef=useRef<HTMLImageElement>(null);
 useEffect(()=>{setLoaded(Boolean(imageRef.current?.complete&&imageRef.current.naturalWidth>0));},[version]);
 return <a href="/" className={'techview-brand brand-'+variant} aria-label="TechView Saldo, página inicial"><img ref={imageRef} src={'/api/brand/logo?v='+encodeURIComponent(version)} alt="Logo TechView — Convertemos cliques em vendas" onLoad={()=>setLoaded(true)} onError={()=>setLoaded(false)} style={{display:loaded?'block':'none'}}/>{!loaded&&<span className="brand">TECH<span>VIEW</span><small>SALDO</small></span>}</a>;
}
