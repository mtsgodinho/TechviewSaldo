import {NextResponse} from 'next/server';
import {actor} from '@/lib/supabase';
import {fetchPolygonRate} from '@/lib/polygon-rate';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){let authorized=false;try{await actor();authorized=true;return NextResponse.json(await fetchPolygonRate(),{headers});}catch(e){return NextResponse.json({error:(e as Error).message},{status:authorized?503:403,headers});}}
