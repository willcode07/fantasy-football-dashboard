import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the dashboard', () => {
  render(<App />);
  expect(screen.getByText(/Fantasy Football MNPS Dashboard/i)).toBeInTheDocument();
});
