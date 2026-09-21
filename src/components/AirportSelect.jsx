import { useMemo } from 'react';
import { AIRPORTS } from '../data/airports.js';
import { groupAirports, airportOptionLabel } from '../utils/airportGroups.js';
import { useGame } from '../store/GameContext.jsx';
import { fuelBasisText } from './FuelBasisChip.jsx';

/**
 * Grouped airport picker: the player's hubs and focus cities pinned at the top,
 * then every region, alphabetical by city inside each group.
 */
export default function AirportSelect({
  value, onChange, gates, hubs, exclude = null, placeholder = null,
  showGates = true, requireGate = true, ...rest
}) {
  // Station fuel basis in every option row (FUEL_OPERATIONS_PLAN.md §7.3) —
  // an <option> can't hold a chip, so it is text; empty in a classic world.
  const { state } = useGame();
  const groups = useMemo(
    () => groupAirports({ airports: AIRPORTS, gates, hubs, exclude, requireGate }),
    [gates, hubs, exclude, requireGate],
  );

  return (
    <select
      className="form-select"
      value={value}
      onChange={e => onChange(e.target.value)}
      {...rest}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {groups.map(g => (
        <optgroup key={g.label} label={g.label}>
          {g.airports.map(a => (
            <option key={a.code} value={a.code}>
              {airportOptionLabel(a, gates, showGates)}{fuelBasisText(a.code, state)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
