import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Pagination, TableFoot } from './Pagination';

describe('Pagination', () => {
  it('hides itself when there is a single page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('disables prev on the first page and next on the last page', () => {
    render(<Pagination page={1} totalPages={3} onChange={() => {}} />);
    expect(screen.getByLabelText('上一页')).toBeDisabled();
    expect(screen.getByLabelText('下一页')).toBeEnabled();
  });

  it('requests the adjacent page on click', () => {
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('下一页'));
    expect(onChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByLabelText('上一页'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('marks the current page for assistive tech', () => {
    render(<Pagination page={2} totalPages={5} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('TableFoot', () => {
  it('summarises total, page and unit', () => {
    render(<TableFoot total={42} page={2} totalPages={5} onChange={() => {}} unit="人" />);
    expect(screen.getByText(/共 42 人 · 第 2 页/)).toBeInTheDocument();
  });
});
