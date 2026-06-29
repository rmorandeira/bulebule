import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

const CLOSE_DURATION = 260

const CATEGORIES = [
  { id: 'all',         label: 'Todo',        emoji: '🛍️' },
  { id: 'collectible', label: 'Coleccionables', emoji: '🎲' },
  { id: 'landmark',    label: 'Monumentos',  emoji: '🏛️' },
  { id: 'figure',      label: 'Personajes',  emoji: '🧑‍🎨' },
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

  const pagerRef       = useRef(null)
  const scrollTimerRef = useRef(null)
  const progScrollRef  = useRef(false)
  const closeRef       = useRef(null)

  useEffect(() => {
    socket.emit('get_marketplace', (res) => {
      if (!res?.ok) return
      setItems(res.items)
      setUserItems(res.userItems ?? [])
      setCredits(res.credits ?? 0)
    })
  }, [])

  // Snap carousel to the active category card
  function snapToCategory(id) {
    const pager = pagerRef.current
    if (!pager) return
    const idx = CATEGORIES.findIndex(c => c.id === id)
    const card = pager.children[idx]
    if (card) {
      progScrollRef.current = true
      pager.scrollTo({ left: card.offsetLeft - (pager.offsetWidth - card.offsetWidth) / 2, behavior: 'smooth' })
      setTimeout(() => { progScrollRef.current = false }, 400)
    }
  }

  function handleCategoryClick(id) {
    setActiveCategory(id)
    snapToCategory(id)
  }

  function handleCarouselScroll() {
    if (progScrollRef.current) return
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const pager = pagerRef.current
      if (!pager) return
      const center = pager.scrollLeft + pager.offsetWidth / 2
      let closest = null
      let minDist = Infinity
      Array.from(pager.children).forEach((card, i) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2
        const dist = Math.abs(center - cardCenter)
        if (dist < minDist) { minDist = dist; closest = i }
      })
      if (closest !== null) {
        const cat = CATEGORIES[closest]
        if (cat && cat.id !== activeCategory) setActiveCategory(cat.id)
      }
    }, 80)
  }

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

  const owned = (id) => userItems.includes(id)

  const visibleItems = activeCategory === 'all'
    ? items
    : items.filter(i => i.category === activeCategory)

  // Only show categories that have items
  const availableCategories = CATEGORIES.filter(c =>
    c.id === 'all' || items.some(i => i.category === c.id)
  )

  return (
    <div className="mkt">
      {/* Category carousel */}
      <div className="mkt__carousel" ref={pagerRef} onScroll={handleCarouselScroll}>
        {availableCategories.map(cat => (
          <div
            key={cat.id}
            className={`mkt__cat-card${activeCategory === cat.id ? ' mkt__cat-card--active' : ''}`}
            onClick={() => handleCategoryClick(cat.id)}
          >
            <span className="mkt__cat-emoji">{cat.emoji}</span>
            <span className="mkt__cat-label">{cat.label}</span>
            <span className="mkt__cat-count">
              {cat.id === 'all' ? items.length : items.filter(i => i.category === cat.id).length} items
            </span>
          </div>
        ))}
      </div>

      {/* Items grid */}
      <div className="mkt__grid">
        {visibleItems.map(item => (
          <div
            key={item.id}
            className={`mkt__card${owned(item.id) ? ' mkt__card--owned' : ''}`}
            onClick={() => openItem(item)}
          >
            <div className="mkt__card-img-wrap">
              <img
                className="mkt__card-img"
                src={item.image_url}
                alt={item.name}
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
              {owned(item.id) && <span className="mkt__owned-badge">Tuyo</span>}
            </div>
            <p className="mkt__card-name">{item.name}</p>
            <p className="mkt__card-price">{item.price.toLocaleString()} puntos</p>
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
              <p className="mkt__sheet-price">{selected.price.toLocaleString()} puntos</p>

              {error && <p className="bs__error">{error}</p>}

              {owned(selected.id) ? (
                <button className="bs__submit" disabled>Ya lo tienes ✓</button>
              ) : !user ? (
                <p className="mkt__sheet-hint">Inicia sesión para comprar</p>
              ) : credits < selected.price ? (
                <button className="bs__submit" disabled>Créditos insuficientes</button>
              ) : (
                <button className="bs__submit" onClick={handleBuy} disabled={buying}>
                  {buying ? 'Comprando...' : `Comprar · ${selected.price.toLocaleString()} pts`}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
