import { AnimalSelector } from './AnimalSelector';
import type { Animal } from '../types';

interface ProfileFormProps {
  selectedAnimal: Animal | null;
  onSelectAnimal: (animal: Animal) => void;
  profileName: string;
  onProfileNameChange: (name: string) => void;
}

export function ProfileForm({ selectedAnimal, onSelectAnimal, profileName, onProfileNameChange }: ProfileFormProps) {
  return (
    <div className="card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Step 2</p>
          <h2>Personalize your device</h2>
          <p className="text-muted">Set a name and icon that others will see</p>
        </div>
      </div>

      <div className="input-grid">
        <div className="input-group">
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            className="input"
            type="text"
            placeholder="e.g. Living Room"
            maxLength={24}
            value={profileName}
            onChange={(e) => onProfileNameChange(e.target.value)}
          />
        </div>
      </div>

      <AnimalSelector selectedAnimal={selectedAnimal} onSelect={onSelectAnimal} />
    </div>
  );
}
