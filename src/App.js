// src/App.js
import React from 'react';
import './App.css';
import FantasyDashboard from './components/FantasyDashboard';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<FantasyDashboard />} />
                {/* Add other routes as needed */}
            </Routes>
        </Router>
    );
}

export default App;
