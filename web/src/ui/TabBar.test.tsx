import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';

test('tab bar shows 4 labelled tabs and a central add button', () => {
  const go = vi.fn();
  render(<TabBar current="home" onGo={go} />);
  expect(screen.getAllByRole('link').map(a => a.textContent)).toEqual(['Home','Bills','','Reports','Settings']);
  fireEvent.click(screen.getByLabelText('Add'));
  expect(go).toHaveBeenCalledWith('add');
});

test('active tab has aria-current and normal tabs call onGo with their route', () => {
  const go = vi.fn();
  render(<TabBar current="bills" onGo={go} />);
  expect(screen.getByText('Bills').closest('a')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Home').closest('a')).not.toHaveAttribute('aria-current');
  fireEvent.click(screen.getByText('Reports'));
  expect(go).toHaveBeenCalledWith('reports');
});
