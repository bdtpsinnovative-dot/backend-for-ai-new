import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// ค่า Config
const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: Request) {
  try {
    const { token } = await req.json()

    // 1. ตรวจสอบ Token ว่าถูกต้องไหม
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. หา Team ID ของ User คนนี้
    const { data: profile } = await supabase
      .from('profiles')
      .select('team_id')
      .eq('id', user.id)
      .single()

    const teamId = profile?.team_id

    // 🌟 3. ดึงข้อมูล "โครงการ" (ตารางหลาน) ทั้งหมดที่ยังไม่ถูกลบ
    // พร้อมดึง user_id และ team_id จากตารางแม่ ลงมาใช้คำนวณ
    const { data: projects, error: projectsError } = await supabase
      .from('order_item_projects')
      .select(`
        id,
        order_items!inner (
          orders!inner (
            user_id,
            team_id
          )
        )
      `)
      .eq('is_deleted', false) // 👈 ไฮไลท์สำคัญ: ตัดโปรเจกต์ที่โดนลบออกไปเลย

    if (projectsError) throw projectsError

    // 4. เริ่มคำนวณยอด
    let myCount = 0
    let teamCount = 0

    projects?.forEach((proj: any) => {
      // เข้าถึงข้อมูลตารางแม่ (orders) ที่เรา Join ย้อนขึ้นไป
      const orderData = proj.order_items?.orders
      if (!orderData) return

      if (orderData.user_id === user.id) {
        // ถ้ารหัสตรงกับตัวเอง -> นับเป็นยอด "ของฉัน"
        myCount++
      } else if (teamId && orderData.team_id === teamId) {
        // ถ้ารหัสไม่ตรงตัวเอง แต่ทีมเดียวกัน -> นับเป็นยอด "ของทีม"
        teamCount++
      }
    })

    // 5. ส่งค่ากลับไป
    return NextResponse.json({
      myOrders: myCount,
      teamOrders: teamCount,
      totalOrders: myCount + teamCount
    })

  } catch (error) {
    console.error('Stats Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}