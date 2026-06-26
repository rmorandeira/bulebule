import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

const CLOSE_DURATION = 260

export default function Marketplace({ user }) {
  const [items, setItems]         = useState([])
  const [userItems, setUserItems] = useState([])
  const [credits, setCredits]     = useState(0)
  const [selected, setSelected]   = useState(null)
  const [closing, setClosing]     = useState(false)
  const [buying, setBuying]       = useState(false)
  const [error, setError]         = useState('')
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

  const owned = (id) => userItems.includes(id)

  return (
    <div className="mkt">
      <div className="mkt__grid">
        {items.map(item => (
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
