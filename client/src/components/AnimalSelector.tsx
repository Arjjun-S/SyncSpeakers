
import { ANIMALS, type Animal } from '../types';

interface AnimalSelectorProps {
  selectedAnimal: Animal | null;
  onSelect: (animal: Animal) => void;
}

export function AnimalSelector({ selectedAnimal, onSelect }: AnimalSelectorProps) {
  return (
    <div className="card">
      <h2>Choose Your Device Name</h2>
      <p className="text-muted mb-4">Pick an animal to represent your device</p>
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
