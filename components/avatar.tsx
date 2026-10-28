'use client';
import {useState} from 'react';
import type {Profile} from '@/lib/types';
export default function Avatar({profile,large=false}:{profile:Profile;large?:boolean}){
 const [failed,setFailed]=useState('');const version=profile.avatar_path||'';
 return <span className={large?'avatar profile-photo':'avatar'}>{version&&failed!==version?<img src={'/api/profile/avatar?id='+profile.id+'&v='+encodeURIComponent(version)} alt={'Foto de '+profile.name} onError={()=>setFailed(version)}/>:profile.name.slice(0,2).toUpperCase()}</span>;
}
