import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) return NextResponse.json({ error: 'กรุณาล็อกอินก่อน' }, { status: 401 });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });

    // 🌟 1. หาว่าคนที่ล็อกอินอยู่ อยู่ทีมไหน (team_id)
    const { data: currentUserProfile } = await supabase
      .from('profiles')
      .select('team_id')
      .eq('id', user.id)
      .single();

    const myTeamId = currentUserProfile?.team_id;

    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select(`
        id, team_name, description, created_at,
        members:profiles ( id, full_name, role, phone_number, avatar_url )
      `)
      .order('created_at', { ascending: true });

    if (teamsError) throw teamsError;

    const { data: unassignedMembers, error: unassignedError } = await supabase
      .from('profiles')
      .select('id, full_name, role, phone_number, avatar_url')
      .is('team_id', null);

    if (unassignedError) throw unassignedError;

    // 🌟 2. แนบสถานะ is_my_team ไปในแต่ละทีม
    let responseData = (teams || []).map(team => ({
      ...team,
      is_my_team: team.id === myTeamId
    }));

    if (unassignedMembers && unassignedMembers.length > 0) {
      responseData.push({
        id: 'team-null',
        team_name: 'Unassigned (ยังไม่มีทีม)',
        description: 'พนักงานที่รอการจัดสรรเข้าทีม',
        created_at: new Date().toISOString(),
        members: unassignedMembers,
        is_my_team: myTeamId === null // ถ้าเรายังไม่มีทีม กลุ่ม Unassigned คือกลุ่มของเรา
      });
    }

    // 🌟 3. จัดเรียงให้ทีมของเราเด้งขึ้นมาอยู่บนสุดของ Array
    responseData.sort((a, b) => {
      if (a.is_my_team) return -1;
      if (b.is_my_team) return 1;
      return 0;
    });

    return NextResponse.json(responseData);

  } catch (error: any) {
    console.error('Teams API Error:', error); 
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}