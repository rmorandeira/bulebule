import { useSheetDrag } from '../hooks/useSheetDrag'
import { useTranslation } from '../i18n'

const HAND_KEYS = ['repoker', 'poker', 'full', 'escalera', 'trio', 'dobles', 'pareja', 'alta']

export default function HowToPlaySheet({ closing, onClose }) {
  const { sheetRef, handleProps } = useSheetDrag(onClose)
  const { t } = useTranslation()
  const hands = HAND_KEYS.map((key, i) => ({ rank: HAND_KEYS.length - 1 - i, ...t(`rules.hands.${key}`) }))

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        <p className="rules__heading">{t('rules.heading')}</p>

        <div className="rules__section">
          <p className="rules__section-title">{t('rules.objectiveTitle')}</p>
          <p className="rules__text">{t('rules.objectiveText')}</p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">{t('rules.diceTitle')}</p>
          <p className="rules__text">{t('rules.diceText')}</p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">{t('rules.turnTitle')}</p>
          <p className="rules__text">{t('rules.turnText')}</p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">{t('rules.handsTitle')}</p>
          <div className="rules__hands">
            {hands.map(h => (
              <div key={h.rank} className="rules__hand">
                <span className="rules__hand-rank">{h.rank}</span>
                <div className="rules__hand-info">
                  <p className="rules__hand-name">{h.name}</p>
                  <p className="rules__hand-desc">{h.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">{t('rules.winLoseTitle')}</p>
          <p className="rules__text">{t('rules.winLoseText')}</p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">{t('rules.freeingTitle')}</p>
          <p className="rules__text">{t('rules.freeingText')}</p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">{t('rules.bulesTitle')}</p>
          <p className="rules__text">{t('rules.bulesText')}</p>
        </div>

        <button className="bs__submit" onClick={onClose}>{t('rules.understood')}</button>
      </div>
    </>
  )
}
