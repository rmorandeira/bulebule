import { useState, useEffect, useRef } from 'react'
import socket from '../socket'
import { imgSrc } from '../utils/imgSrc'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { useTranslation } from '../i18n'

const CLOSE_DURATION = 260

const CATEGORIES = [
  { id: 'all',         labelKey: 'categoryAll',         emoji: '🛍️' },
  { id: 'pack',        labelKey: 'categoryPack',        emoji: '💰' },
  { id: 'dice',        labelKey: 'categoryDice',        emoji: '🎲' },
  { id: 'powerup',     labelKey: 'categoryPowerup',     emoji: '⚡' },
  { id: 'collectible', labelKey: 'categoryCollectible', emoji: '🎰' },
  { id: 'landmark',    labelKey: 'categoryLandmark',    emoji: '🏛️' },
  { id: 'figure',      labelKey: 'categoryFigure',      emoji: '🧑‍🎨' },
]


export default function Marketplace({ user }) {
  const { t } = useTranslation()
  const { sheetRef, handleProps } = useSheetDrag(() => closeItem())
  const [items, setItems]         = useState([])
  const [userItems, setUserItems] = useState([])
  const [userItemQuantities, setUserItemQuantities] = useState({})
  const [credits, setCredits]     = useState(0)
  const [selected, setSelected]   = useState(null)
  const [closing, setClosing]     = useState(false)
  const [buying, setBuying]       = useState(false)
  const [error, setError]         = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeSkin, setActiveSkin] = useState(() => localStorage.getItem('bule_dice_skin') ?? null)
  const [buyQty, setBuyQty]       = useState(1)
  const closeRef = useRef(null)

  const STACKABLE_CATEGORIES = ['powerup']

  useEffect(() => {
    socket.emit('get_marketplace', (res) => {
      if (!res?.ok) return
      setItems(res.items)
      setUserItems(res.userItems ?? [])
      setUserItemQuantities(res.userItemQuantities ?? {})
      setCredits(res.credits ?? 0)
    })
  }, [])

  function openItem(item) {
    clearTimeout(closeRef.current)
    setClosing(false)
    setError('')
    setBuyQty(1)
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
    const stackable = STACKABLE_CATEGORIES.includes(selected.category)
    const qty = stackable ? buyQty : 1
    setBuying(true)
    setError('')
    socket.emit('buy_item', { itemId: selected.id, quantity: qty }, (res) => {
      setBuying(false)
      if (!res?.ok) { setError(res?.error ?? t('shop.buyErrorGeneric')); return }
      setUserItems(prev => prev.includes(selected.id) ? prev : [...prev, selected.id])
      setUserItemQuantities(prev => ({ ...prev, [selected.id]: (prev[selected.id] ?? 0) + qty }))
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
      if (!res?.ok) { setError(res?.error ?? t('shop.packErrorGeneric')); return }
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
            <span>{t(`shop.${cat.labelKey}`)}</span>
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div className="mkt__grid">
        {visibleItems.map(item => (
          <div
            key={item.id}
            className={`mkt__card${owned(item.id) ? ' mkt__card--owned' : ''}${!item.active ? ' mkt__card--inactive' : ''}`}
            onClick={() => openItem(item)}
          >
            <div className="mkt__card-img-wrap">
              <img
                className="mkt__card-img"
                src={imgSrc(item.image_url)}
                alt={item.name}
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
              {!item.active && <span className="mkt__inactive-badge">{t('shop.unavailable')}</span>}
              {item.active && activeSkin === item.id && <span className="mkt__active-badge">{t('shop.active')}</span>}
              {STACKABLE_CATEGORIES.includes(item.category)
                ? (userItemQuantities[item.id] > 0) && (
                    <span className="mkt__owned-badge">x{userItemQuantities[item.id]}</span>
                  )
                : owned(item.id) && <span className="mkt__owned-badge">{t('shop.owned')}</span>
              }
            </div>
            <p className="mkt__card-name">{item.name}</p>
            <p className="mkt__card-price">
              {item.category === 'pack' ? '1 €' : item.price === 0 ? t('shop.free') : t('shop.bules', { n: item.price.toLocaleString() })}
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
          <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
            <div className="bs__handle" {...handleProps} />
            <div className="mkt__sheet">
              <div className="mkt__sheet-img-wrap">
                <img
                  className="mkt__sheet-img"
                  src={imgSrc(selected.image_url)}
                  alt={selected.name}
                  onError={e => { e.currentTarget.style.display = 'none' }}
                />
              </div>
              <p className="mkt__sheet-name">{selected.name}</p>
              {selected.description && (
                <p className="mkt__sheet-desc" dangerouslySetInnerHTML={{ __html: selected.description }} />
              )}

              {error && <p className="bs__error">{error}</p>}

              {selected.category === 'pack' ? (
                <>
                  <div className="mkt__bizum">
                    <p className="mkt__bizum-label">{t('shop.bizumHint')}</p>
                  </div>
                  <button className="bs__submit" disabled>
                    {t('shop.buyPack')}
                  </button>
                </>
              ) : STACKABLE_CATEGORIES.includes(selected.category) ? (
                <>
                  <p className="mkt__sheet-price">
                    {t('shop.bules', { n: (selected.price * buyQty).toLocaleString() })}
                  </p>
                  <p className="mkt__sheet-hint">{t('shop.youHave', { n: userItemQuantities[selected.id] ?? 0 })}</p>
                  {!selected.active ? (
                    <button className="bs__submit" disabled>{t('shop.notAvailable')}</button>
                  ) : !user ? (
                    <p className="mkt__sheet-hint">{t('shop.loginToBuy')}</p>
                  ) : (
                    <>
                      <div className="mkt__qty">
                        <button
                          type="button"
                          className="mkt__qty-btn"
                          onClick={() => setBuyQty(q => Math.max(1, q - 1))}
                          disabled={buyQty <= 1}
                        >−</button>
                        <span className="mkt__qty-value">{buyQty}</span>
                        <button
                          type="button"
                          className="mkt__qty-btn"
                          onClick={() => setBuyQty(q => Math.min(99, q + 1))}
                          disabled={buyQty >= 99}
                        >+</button>
                      </div>
                      <button
                        className="bs__submit"
                        onClick={handleBuy}
                        disabled={buying || credits < selected.price * buyQty}
                      >
                        {buying
                          ? t('shop.buying')
                          : credits < selected.price * buyQty
                            ? t('shop.notEnoughBules')
                            : t('shop.buy', { n: (selected.price * buyQty).toLocaleString() })}
                      </button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p className="mkt__sheet-price">
                    {selected.price === 0 ? t('shop.free') : t('shop.bules', { n: selected.price.toLocaleString() })}
                  </p>
                  {selected.category === 'dice' && (selected.price === 0 || owned(selected.id)) ? (
                    activeSkin === selected.id ? (
                      <button className="bs__submit bs__submit--secondary" onClick={handleUnequip}>
                        {t('user.items.unequip')}
                      </button>
                    ) : (
                      <button className="bs__submit" onClick={() => handleEquip(selected.id)}>
                        {t('user.items.equip')}
                      </button>
                    )
                  ) : owned(selected.id) ? (
                    <button className="bs__submit" disabled>{t('shop.alreadyOwned')}</button>
                  ) : !selected.active ? (
                    <button className="bs__submit" disabled>{t('shop.notAvailable')}</button>
                  ) : !user ? (
                    <p className="mkt__sheet-hint">{t('shop.loginToBuy')}</p>
                  ) : credits < selected.price ? (
                    <button className="bs__submit" disabled>{t('shop.notEnoughBules')}</button>
                  ) : (
                    <button className="bs__submit" onClick={handleBuy} disabled={buying}>
                      {buying ? t('shop.buying') : t('shop.buy', { n: selected.price.toLocaleString() })}
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
