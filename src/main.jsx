import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BadgeCheck,
  Bell,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  DoorOpen,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  LogOut,
  Phone,
  Search,
  ShieldCheck,
  Ticket,
  Upload,
  XCircle,
} from 'lucide-react'
import './styles.css'

const api = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'include',
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || '请求失败')
  }
  return payload
}

const formatMoney = (value) => `¥${Number(value || 0).toFixed(0)}`
const today = () => new Date().toISOString().slice(0, 10)

const rules = [
  '入场前请完成登记、免责协议和付款凭证提交',
  '安全第一，建议佩戴护具；酒后、危险行为禁止入场',
  '禁止在场地内抽烟、乱丢烟头',
  '禁止进入吧台区域拿取物品或存放个人物品',
  '核销后方可进入滑板区域，工作人员有权抽查凭证',
]

const statusLabels = {
  pending_payment_review: '待核销',
  checked_in: '已入场',
  rejected: '异常',
  expired: '已过期',
}

const ageOptions = [
  { value: 'adult', label: '已满 18 岁' },
  { value: 'minor', label: '未满 18 岁' },
]

function SkateboardIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="滑板" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 35c7-12 33-12 40 0" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M14 36c9 8 27 8 36 0" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <circle cx="22" cy="47" r="5" fill="currentColor" />
      <circle cx="42" cy="47" r="5" fill="currentColor" />
    </svg>
  )
}

function Hero({ onStart, onAdmin }) {
  return (
    <section className="hero">
      <img src="/assets/summon-night.jpg" alt="SUMMON Skatepark 夜间场地" className="hero-image" />
      <div className="hero-overlay" />
      <div className="hero-content">
        <div className="brand-mark">
            <img src="/assets/summon-logo-complete.png" alt="SUMMON Skatepark" />
        </div>
        <div className="official-chip">
          <ShieldCheck size={16} />
          半自助入场系统
        </div>
        <h1>SUMMON Skatepark 自助入场</h1>
        <div className="intro-card">
          <p>扫码登记、签署免责、上传付款截图后生成入场凭证。</p>
          <p>到门口报手机号或取票码，由工作人员核销后放行。</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="primary-action" onClick={onStart}>
            <DoorOpen size={20} />
            立即入场
          </button>
          <button type="button" className="ghost-action" onClick={onAdmin}>
            <LayoutDashboard size={20} />
            工作人员后台
          </button>
        </div>
      </div>
    </section>
  )
}

function TicketCards({ tickets, selectedTicketId, onSelect }) {
  const icons = {
    single: SkateboardIcon,
    student: GraduationCap,
    'tuesday-free': CalendarDays,
  }
  return (
    <div className="price-grid dynamic-ticket-grid">
      {tickets.map((item, index) => {
        const Icon = icons[item.id] || Ticket
        const active = selectedTicketId === item.id
        return (
          <button className={`price-card ticket-option ${active ? 'is-selected' : ''}`} style={{ '--ticket-index': index }} key={item.id} onClick={() => onSelect(item.id)} type="button">
            <div className="price-icon">
              <Icon size={24} />
            </div>
            <div>
              <h3>{item.name}</h3>
              <strong>{item.price === 0 ? 'FREE' : formatMoney(item.price)}</strong>
              <p>{item.description}</p>
            </div>
            <span className="ticket-cta">选择后进入付款</span>
          </button>
        )
      })}
    </div>
  )
}

function QRPlaceholder({ label, amount, imageSrc }) {
  return (
    <div className="payment-panel">
      <div className="payment-head">
        <span>{label}</span>
        <strong>{amount}</strong>
      </div>
      <div className="qr-box" aria-label={`${label} 收款二维码占位`}>
        {imageSrc ? (
          <img src={imageSrc} alt={`${label} 收款二维码`} className="qr-image" />
        ) : (
          <>
            <div className="qr-grid" />
            <div className="qr-center">
              <Ticket size={26} strokeWidth={2.4} />
              <span>QR</span>
            </div>
          </>
        )}
      </div>
      <p>付款后请保留截图，下一步上传作为核销凭证。</p>
    </div>
  )
}

function PaymentChoices({ ticket }) {
  return (
    <div className="payment-choice-grid">
      <QRPlaceholder label={`微信支付 · ${ticket.name}`} amount={formatMoney(ticket.price)} imageSrc="/assets/wechat-qr.png" />
      <QRPlaceholder label={`支付宝 · ${ticket.name}`} amount={formatMoney(ticket.price)} imageSrc="/assets/alipay-qr.png" />
    </div>
  )
}

function EntryFlow({ tickets, onCreated }) {
  const [stage, setStage] = useState('ticket')
  const [form, setForm] = useState({
    ticketId: '',
    name: '',
    phone: '',
    smsCode: '',
    ageGroup: 'adult',
    guardianName: '',
    guardianPhone: '',
    guardianConsent: false,
    waiverAccepted: false,
    paymentScreenshot: '',
  })
  const [codeSent, setCodeSent] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const selectedTicket = tickets.find((ticket) => ticket.id === form.ticketId)
  const needsPayment = selectedTicket?.requiresPaymentScreenshot

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const chooseTicket = (id) => {
    update('ticketId', id)
    setStage('payment')
  }

  const sendCode = async () => {
    setError('')
    setBusy('sms')
    try {
      const result = await api('/sms/send', {
        method: 'POST',
        body: JSON.stringify({ phone: form.phone }),
      })
      setCodeSent(result.devCode ? `测试验证码：${result.devCode}` : '验证码已发送')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const handleFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('付款截图只支持图片格式')
      return
    }
    if (file.size > 1024 * 1024 * 2) {
      setError('付款截图不能超过 2MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => update('paymentScreenshot', reader.result)
    reader.readAsDataURL(file)
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy('submit')
    try {
      const payload = await api('/orders', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      onCreated(payload.order)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="section-block entry-flow" id="entry">
      <div className="section-title">
        <span>Check-in</span>
        <h2>立即入场</h2>
      </div>
      {stage === 'ticket' && (
        <div className="flow-step">
          <div className="step-badge">01</div>
          <div>
            <h3>选择票种</h3>
            <TicketCards tickets={tickets} selectedTicketId={form.ticketId} onSelect={chooseTicket} />
          </div>
        </div>
      )}

      {stage === 'payment' && selectedTicket && (
        <div className="flow-panel">
          <div className="flow-step">
            <div className="step-badge">02</div>
            <div>
              <h3>{selectedTicket.name}付款</h3>
              {needsPayment ? (
                <div className="single-payment">
                  <PaymentChoices ticket={selectedTicket} />
                  <div className="notice">
                    <CircleAlert size={20} />
                    <p>请选择微信或支付宝完成付款并保留截图，下一步会上传付款截图生成待核销凭证。</p>
                  </div>
                </div>
              ) : (
                <div className="free-payment">
                  <CheckCircle2 size={30} />
                  <strong>该票种无需付款</strong>
                  <p>继续完成登记和免责协议后，即可生成待核销凭证。</p>
                </div>
              )}
              <div className="flow-actions">
                <button type="button" className="ghost-action" onClick={() => setStage('ticket')}>重新选择票种</button>
                <button type="button" className="primary-action" onClick={() => setStage('details')}>{needsPayment ? '我已付款，继续登记' : '继续登记'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {stage === 'details' && (
      <form className="flow-panel" onSubmit={submit}>
        <div className="flow-step">
          <div className="step-badge">03</div>
          <div className="form-grid">
            <label>
              姓名
              <input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="请输入真实姓名" />
            </label>
            <label>
              手机号
              <div className="inline-control">
                <input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="11 位手机号" />
                <button type="button" onClick={sendCode} disabled={busy === 'sms'}>
                  {busy === 'sms' ? <Loader2 size={16} className="spin" /> : <Phone size={16} />}
                  发验证码
                </button>
              </div>
              {codeSent && <small>{codeSent}</small>}
            </label>
            <label>
              短信验证码
              <input value={form.smsCode} onChange={(event) => update('smsCode', event.target.value)} placeholder="6 位验证码" />
            </label>
            <label>
              年龄
              <select value={form.ageGroup} onChange={(event) => update('ageGroup', event.target.value)}>
                {ageOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {form.ageGroup === 'minor' && (
              <>
                <label>
                  监护人姓名
                  <input value={form.guardianName} onChange={(event) => update('guardianName', event.target.value)} placeholder="监护人姓名" />
                </label>
                <label>
                  监护人手机号
                  <input value={form.guardianPhone} onChange={(event) => update('guardianPhone', event.target.value)} placeholder="监护人手机号" />
                </label>
              </>
            )}
          </div>
        </div>

        <div className="flow-step">
          <div className="step-badge">04</div>
          <div className="waiver-box">
            <h3>安全须知与免责协议</h3>
            <p>本人确认已了解滑板运动存在摔倒、碰撞等风险，将遵守场地规则并按自身能力练习。若发现身体不适、场地异常或受伤，将立即停止并联系工作人员。</p>
            <label className="check-row">
              <input type="checkbox" checked={form.waiverAccepted} onChange={(event) => update('waiverAccepted', event.target.checked)} />
              我已阅读并同意 SUMMON Skatepark 安全须知与免责协议
            </label>
            {form.ageGroup === 'minor' && (
              <label className="check-row">
                <input type="checkbox" checked={form.guardianConsent} onChange={(event) => update('guardianConsent', event.target.checked)} />
                监护人已知晓并同意未成年人入场
              </label>
            )}
          </div>
        </div>

        <div className="flow-step">
          <div className="step-badge">05</div>
          <div>
            <h3>上传付款截图</h3>
            {needsPayment ? (
              <label className="upload-box">
                <Upload size={22} />
                <span>{form.paymentScreenshot ? '已选择付款截图，可重新上传' : '上传微信 / 支付宝付款截图'}</span>
                <input type="file" accept="image/*" onChange={handleFile} />
              </label>
            ) : (
              <p className="muted-copy">该票种不需要付款截图，但仍需完成登记和免责协议。</p>
            )}
          </div>
        </div>

        {error && <div className="error-box"><CircleAlert size={18} />{error}</div>}
        <button className="ghost-action" type="button" onClick={() => setStage('payment')}>返回付款页</button>
        <button className="submit-action" type="submit" disabled={busy === 'submit'}>
          {busy === 'submit' ? <Loader2 size={20} className="spin" /> : <ClipboardCheck size={20} />}
          生成入场凭证
        </button>
      </form>
      )}
    </section>
  )
}

function Voucher({ order, onReset }) {
  return (
    <section className="voucher-card">
      <CheckCircle2 size={36} />
      <span>入场凭证已生成</span>
      <h2>{order.pickupCode}</h2>
      <dl>
        <div><dt>手机号</dt><dd>{order.phone}</dd></div>
        <div><dt>票种</dt><dd>{order.ticketName}</dd></div>
        <div><dt>状态</dt><dd>{statusLabels[order.status]}</dd></div>
        <div><dt>提交时间</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div>
      </dl>
      <p>请到门口报手机号或取票码，由工作人员核销后入场。</p>
      <button type="button" onClick={onReset}>继续办理下一位</button>
    </section>
  )
}

function PublicApp({ tickets, onAdmin }) {
  const [createdOrder, setCreatedOrder] = useState(null)
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <Hero onStart={() => document.getElementById('entry')?.scrollIntoView({ behavior: 'smooth' })} onAdmin={onAdmin} />
      <section className="content-wrap">
        <div className="status-strip">
          <BadgeCheck size={20} />
          <span>付款截图提交后生成待核销凭证，收入以工作人员确认核销为准。</span>
        </div>

        {createdOrder ? (
          <Voucher order={createdOrder} onReset={() => setCreatedOrder(null)} />
        ) : (
          <EntryFlow tickets={tickets} onCreated={setCreatedOrder} />
        )}

        <section className="section-block rules-section">
          <div className="section-title">
            <span>Rules</span>
            <h2>入场规则</h2>
          </div>
          <ul className="rules-list">
            {rules.map((rule, index) => (
              <li key={rule}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{rule}</p>
              </li>
            ))}
          </ul>
        </section>

        <footer className="footer-action">
          <button type="button">
            <Bell size={20} />
            加入 SUMMON 滑板群 / 获取活动通知
          </button>
          <p>该按钮不影响入场；入场以后台核销结果为准。</p>
        </footer>
      </section>
    </main>
  )
}

function AdminApp({ tickets, onExit }) {
  const [session, setSession] = useState(null)
  const [password, setPassword] = useState('')
  const [orders, setOrders] = useState([])
  const [report, setReport] = useState(null)
  const [query, setQuery] = useState('')
  const [reportDate, setReportDate] = useState(today())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const loadAdminData = async () => {
    const [ordersPayload, reportPayload] = await Promise.all([
      api(`/admin/orders?q=${encodeURIComponent(query)}`),
      api(`/admin/report?date=${reportDate}`),
    ])
    setOrders(ordersPayload.orders)
    setReport(reportPayload.report)
  }

  useEffect(() => {
    if (session) {
      loadAdminData().catch((err) => setError(err.message))
    }
  }, [session, reportDate])

  const login = async (event) => {
    event.preventDefault()
    setBusy('login')
    setError('')
    try {
      const payload = await api('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setSession(payload.staff)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const changeStatus = async (orderId, action) => {
    const note = action === 'reject' ? window.prompt('异常原因：未付款、截图不清、金额不符或重复入场') || '未填写原因' : ''
    setBusy(orderId)
    setError('')
    try {
      await api(`/admin/orders/${orderId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      })
      await loadAdminData()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const summaryItems = report ? [
    ['今日订单', report.totalOrders],
    ['已核销', report.checkedInCount],
    ['普通票收入', formatMoney(report.revenueByTicket['单次入场'] || 0)],
    ['学生票收入', formatMoney(report.revenueByTicket['学生票'] || 0)],
    ['免费票人数', report.freeTicketCount],
    ['异常订单', report.rejectedCount],
  ] : []

  if (!session) {
    return (
      <main className="admin-shell login-shell">
        <form className="login-panel" onSubmit={login}>
          <img src="/assets/summon-logo-complete.png" alt="SUMMON Skatepark" />
          <h1>工作人员后台</h1>
          <p>默认密码为 <strong>summon123</strong>，上线前请在环境变量中修改。</p>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="后台密码" />
          {error && <div className="error-box"><CircleAlert size={18} />{error}</div>}
          <button type="submit" disabled={busy === 'login'}>
            {busy === 'login' ? <Loader2 size={20} className="spin" /> : <ShieldCheck size={20} />}
            登录后台
          </button>
          <button className="link-button" type="button" onClick={onExit}>返回用户端</button>
        </form>
      </main>
    )
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <span>SUMMON Admin</span>
          <h1>核销与日报</h1>
        </div>
        <button type="button" onClick={onExit}>
          <LogOut size={18} />
          返回用户端
        </button>
      </header>

      <section className="admin-grid">
        {summaryItems.map(([label, value]) => (
          <article className="summary-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="admin-toolbar">
        <label>
          日报日期
          <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
        </label>
        <label>
          手机号 / 取票码
          <div className="inline-control">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订单" />
            <button type="button" onClick={() => loadAdminData()}>
              <Search size={16} />
              搜索
            </button>
          </div>
        </label>
      </section>

      {error && <div className="error-box admin-error"><CircleAlert size={18} />{error}</div>}

      <section className="orders-list">
        {orders.map((order) => (
          <article className="order-card" key={order.id}>
            <div className="order-main">
              <span className={`status-pill ${order.status}`}>{statusLabels[order.status]}</span>
              <h2>{order.pickupCode} · {order.ticketName}</h2>
              <p>{order.visitorName} / {order.phone} / {formatMoney(order.amount)}</p>
              <small>提交：{new Date(order.createdAt).toLocaleString()}</small>
              {order.note && <small>备注：{order.note}</small>}
            </div>
            {order.paymentScreenshot ? (
              <a className="screenshot-link" href={order.paymentScreenshot} target="_blank" rel="noreferrer">查看付款截图</a>
            ) : (
              <span className="screenshot-link is-empty">无需截图</span>
            )}
            <div className="order-actions">
              <button type="button" disabled={order.status !== 'pending_payment_review' || busy === order.id} onClick={() => changeStatus(order.id, 'checkin')}>
                <CheckCircle2 size={18} />
                确认并核销
              </button>
              <button type="button" className="reject-button" disabled={order.status !== 'pending_payment_review' || busy === order.id} onClick={() => changeStatus(order.id, 'reject')}>
                <XCircle size={18} />
                标记异常
              </button>
            </div>
          </article>
        ))}
        {!orders.length && <div className="empty-state">暂无订单</div>}
      </section>

      <section className="section-block">
        <div className="section-title">
          <span>Tickets</span>
          <h2>票种配置</h2>
        </div>
        <div className="ticket-table">
          {tickets.map((ticket) => (
            <div key={ticket.id}>
              <strong>{ticket.name}</strong>
              <span>{formatMoney(ticket.price)}</span>
              <span>{ticket.enabled ? '启用' : '停用'}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function App() {
  const [tickets, setTickets] = useState([])
  const [mode, setMode] = useState(window.location.hash === '#admin' ? 'admin' : 'public')
  const [error, setError] = useState('')

  useEffect(() => {
    api('/tickets')
      .then((payload) => setTickets(payload.tickets))
      .catch((err) => setError(err.message))
  }, [])

  const enabledTickets = useMemo(() => tickets.filter((ticket) => ticket.enabled), [tickets])

  if (error) {
    return <main className="fatal-state">系统暂时不可用：{error}</main>
  }

  if (!enabledTickets.length) {
    return <main className="fatal-state"><Loader2 className="spin" /> 正在加载系统...</main>
  }

  return mode === 'admin' ? (
    <AdminApp tickets={tickets} onExit={() => { window.location.hash = ''; setMode('public') }} />
  ) : (
    <PublicApp tickets={enabledTickets} onAdmin={() => { window.location.hash = 'admin'; setMode('admin') }} />
  )
}

createRoot(document.getElementById('root')).render(<App />)
