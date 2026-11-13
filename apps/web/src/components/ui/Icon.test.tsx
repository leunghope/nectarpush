import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from './Icon';

function classesOf(container: HTMLElement): string[] {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('svg not rendered');
  return Array.from(svg.classList);
}

describe('Icon', () => {
  it('applies the base .icon class by default', () => {
    const { container } = render(<Icon name="list" />);
    expect(classesOf(container)).toEqual(['icon']);
  });

  it('keeps modifier classes while adding the base class', () => {
    const { container } = render(<Icon name="list" className="nav-icon" />);
    expect(classesOf(container)).toEqual(['icon', 'nav-icon']);
  });

  it('does not duplicate the base class when the caller passes it', () => {
    const { container } = render(<Icon name="x" className="icon icon-sm extra" />);
    expect(classesOf(container)).toEqual(['icon', 'icon-sm', 'extra']);
  });

  it('tolerates an explicit empty className', () => {
    const { container } = render(<Icon name="user" className="" />);
    expect(classesOf(container)).toEqual(['icon']);
  });
});