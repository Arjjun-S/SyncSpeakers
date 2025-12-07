
import { ANIMALS, type Animal } from '../types';

interface AnimalSelectorProps {
  selectedAnimal: Animal | null;
  onSelect: (animal: Animal) => void;
}

export function AnimalSelector({ selectedAnimal, onSelect }: AnimalSelectorProps) {
  return (
    <div>
      <h3 style={{ marginBottom: '8px' }}>Pick an icon</h3>
      <div className="animal-grid">
        {ANIMALS.map((animal) => (
          <button
            key={animal.name}
            className={`animal-btn ${selectedAnimal?.name === animal.name ? 'selected' : ''}`}
            onClick={() => onSelect(animal)}
          >
            <span className="animal-emoji">{animal.emoji}</span>
            <span className="animal-name">{animal.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
