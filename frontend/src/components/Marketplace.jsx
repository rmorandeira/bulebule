import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

const CLOSE_DURATION = 260

const CATEGORIES = [
  { id: 'all',         label: 'Todo',           emoji: '🛍️' },
  { id: 'pack',        label: 'Bules',          emoji: '💰' },
  { id: 'dice',        label: 'Dados',          emoji: '🎲' },
  { id: 'collectible', label: 'Coleccionables',  emoji: '🎰' },
  { id: 'landmark',    label: 'Monumentos',      emoji: '🏛️' },
  { id: 'figure',      label: 'Personajes',      emoji: '🧑‍🎨' },
]


export default function Marketplace({ user }) {
  const [items, setItems]         = useState([])
  const [userItems, setUserItems] = useState([])
  const [credits, setCredits]     = useState(0)
  const [selected, setSelected]   = useState(null)
  const [closing, setClosing]     = useState(false)
  const [buying, setBuying]       = useState(false)
  const [error, setError]         = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeSkin, setActiveSkin] = useState(() => localStorage.getItem('bule_dice_skin') ?? null)
  const closeRef = useRef(null)

  useEffect(() => {
    socket.emit('get_marketplace', (res) => {
      if (!res?.ok) return
      setItems(res.items)
      setUserItems(res.userItems ?? [])
      setCredits(res.credits ?? 0)
    })
  }, [])

  function openItem(item) {
    clearTimeout(closeRef.current)
    setClosing(false)
    setError('')
    setSelected(item)
  }

  function closeItem() {
    setClosing(true)
    closeRef.current = setTimeout(() => {
      setSelected(null)
      setClosing(false)
    }, CLOSE_DURATION)
  }

  function handleBuy() {
    if (!selected || buying) return
    setBuying(true)
    setError('')
    socket.emit('buy_item', { itemId: selected.id }, (res) => {
      setBuying(false)
      if (!res?.ok) { setError(res?.error ?? 'Error al comprar'); return }
      setUserItems(prev => [...prev, selected.id])
      setCredits(res.credits)
      closeItem()
    })
  }

  function handleBuyPack() {
    if (!selected || buying) return
    setBuying(true)
    setError('')
    socket.emit('buy_bules_pack', { packId: selected.id }, (res) => {
      setBuying(false)
      if (!res?.ok) { setError(res?.error ?? 'Error al procesar'); return }
      setCredits(res.score)
      closeItem()
    })
  }

  function handleEquip(itemId) {
    localStorage.setItem('bule_dice_skin', itemId)
    setActiveSkin(itemId)
    socket.emit('set_dice_skin', { skinId: itemId })
  }

  function handleUnequip() {
    localStorage.removeItem('bule_dice_skin')
    setActiveSkin(null)
    socket.emit('set_dice_skin', { skinId: null })
  }

  const owned = (id) => userItems.includes(id)

  const visibleItems = activeCategory === 'all'
    ? items
    : items.filter(i => i.category === activeCategory)

  const availableCategories = CATEGORIES.filter(c =>
    c.id === 'all' || items.some(i => i.category === c.id)
  )

  return (
    <div className="mkt">
      {/* Category tabs */}
      <div className="mkt__tabs">
        {availableCategories.map(cat => (
          <button
            key={cat.id}
            className={`mkt__tab${activeCategory === cat.id ? ' mkt__tab--active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            <span className="mkt__tab-emoji">{cat.emoji}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div className="mkt__grid">
        {visibleItems.map(item => (
          <div
            key={item.id}
            className={`mkt__card${owned(item.id) ? ' mkt__card--owned' : ''}${!item.available ? ' mkt__card--disabled' : ''}`}
            onClick={() => item.available ? openItem(item) : undefined}
          >
            <div className="mkt__card-img-wrap">
              <img
                className="mkt__card-img"
                src={item.image_url}
                alt={item.name}
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
              {!item.available && <span className="mkt__disabled-badge">Disabled</span>}
              {item.available && activeSkin === item.id && <span className="mkt__active-badge">Activo</span>}
              {item.available && owned(item.id) && <span className="mkt__owned-badge">Tuyo</span>}
            </div>
            <p className="mkt__card-name">{item.name}</p>
            <p className="mkt__card-price">
              {item.category === 'pack' ? '1 €' : item.price === 0 ? 'Gratis' : `${item.price.toLocaleString()} Bules`}
            </p>
          </div>
        ))}
      </div>

      {selected && (
        <>
          <div
            className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`}
            onClick={closeItem}
          />
          <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
            <div className="bs__handle" />
            <div className="mkt__sheet">
              <div className="mkt__sheet-img-wrap">
                <img
                  className="mkt__sheet-img"
                  src={selected.image_url}
                  alt={selected.name}
                  onError={e => { e.currentTarget.style.display = 'none' }}
                />
              </div>
              <p className="mkt__sheet-name">{selected.name}</p>
              {selected.description && (
                <p className="mkt__sheet-desc">{selected.description}</p>
              )}

              {error && <p className="bs__error">{error}</p>}

              {selected.category === 'pack' ? (
                <>
                  <div className="mkt__bizum">
                    <p className="mkt__bizum-label">Envía <strong>1 €</strong> por Bizum y confirma el pago.</p>
                  </div>
                  <button className="bs__submit" disabled>
                    Comprar Bules
                  </button>
                </>
              ) : (
                <>
                  <p className="mkt__sheet-price">
                    {selected.price === 0 ? 'Gratis' : `${selected.price.toLocaleString()} Bules`}
                  </p>
                  {selected.category === 'dice' && (selected.price === 0 || owned(selected.id)) ? (
                    activeSkin === selected.id ? (
                      <button className="bs__submit bs__submit--secondary" onClick={handleUnequip}>
                        Desactivar skin
                      </button>
                    ) : (
                      <button className="bs__submit" onClick={() => handleEquip(selected.id)}>
                        Activar skin
                      </button>
                    )
                  ) : owned(selected.id) ? (
                    <button className="bs__submit" disabled>Ya lo tienes ✓</button>
                  ) : !user ? (
                    <p className="mkt__sheet-hint">Inicia sesión para comprar</p>
                  ) : credits < selected.price ? (
                    <button className="bs__submit" disabled>Bules insuficientes</button>
                  ) : (
                    <button className="bs__submit" onClick={handleBuy} disabled={buying}>
                      {buying ? 'Comprando...' : `Comprar · ${selected.price.toLocaleString()} Bules`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
