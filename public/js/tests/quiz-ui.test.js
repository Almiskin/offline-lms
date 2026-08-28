/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

function loadApp() {
  document.body.innerHTML = '<main id="app"></main><button id="logout-btn"></button>';
  window.Auth = {
    currentUser: { userId: 1, role: 'Instructor' },
    isLoggedIn: () => true,
    isInstructor: () => true,
    init: async () => {},
    logout: async () => {},
  };
  window.Connectivity = { isOnline: true, onChange: () => {}, init: () => {} };
  window.Store = { getPendingAttempts: async () => [] };
  window.SyncModule = { updatePendingBadge: async () => {} };
  window.Router = { add: () => {}, init: () => {}, resolve: () => {}, navigate: () => {} };
  window.OfflineManager = {};
  window.ReportsModule = {};
  window.Chart = undefined;
  window.confirm = () => true;
  window.Api = { createQuiz: jest.fn().mockResolvedValue({ quizId: 1 }) };
  window.QuizModule = {
    loadQuiz: jest.fn(),
    submitAttemptLocally: jest.fn().mockResolvedValue({}),
  };
  window.history.back = jest.fn();

  // eslint-disable-next-line no-eval
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'));
}

describe('quiz creation and one-at-a-time mode', () => {
  beforeEach(() => loadApp());

  it('sends the selected one-question-at-a-time mode to the API', async () => {
    window.renderNewQuiz({ moduleId: '7' });
    document.getElementById('nq-title').value = 'One at a time';
    document.getElementById('nq-display-mode').value = 'one';
    const question = document.querySelector('#questions-container > div');
    question.querySelector('.q-text').value = 'Question 1';
    question.querySelectorAll('.opt-text')[0].value = 'A';
    question.querySelectorAll('.opt-text')[1].value = 'B';
    question.querySelector('.opt-correct').checked = true;

    document.getElementById('save-quiz-btn').click();
    await Promise.resolve();

    expect(window.Api.createQuiz).toHaveBeenCalledWith('7', expect.objectContaining({ showOneAtATime: true }));
  });

  it('keeps the final submit button working after navigation', async () => {
    window.Auth.isInstructor = () => false;
    window.QuizModule.loadQuiz.mockResolvedValue({
      quiz: { Title: 'Navigation quiz', Instructions: '', ShowOneAtATime: true },
      questions: [
        { QuestionID: 1, QuestionText: 'First', options: [{ OptionID: 11, OptionText: 'A' }] },
        { QuestionID: 2, QuestionText: 'Second', options: [{ OptionID: 21, OptionText: 'B' }] },
      ],
    });

    await window.renderQuizTaking({ id: '3' });
    document.querySelector('.quiz-option').click();
    document.getElementById('next-question-btn').click();
    document.getElementById('quiz-questions').querySelector('.quiz-option').click();
    document.getElementById('submit-quiz-btn').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(window.QuizModule.submitAttemptLocally).toHaveBeenCalledWith(
      '3',
      expect.any(String),
      [
        { questionId: 1, selectedOptionId: 11 },
        { questionId: 2, selectedOptionId: 21 },
      ]
    );
    expect(document.body.textContent).toContain('Quiz saved');
  });
});
