# Bulk Quiz Import

Instructors can preview and import multiple-choice questions from the New Quiz page using `.json`, `.csv`, or `.docx` files. The import is preview-only until the instructor saves the quiz.

## JSON

Use either a top-level array or an object with a `questions` array:

```json
{
  "questions": [
    {
      "questionText": "What is a CPU?",
      "options": [
        { "optionText": "Central Processing Unit", "isCorrect": true },
        { "optionText": "Computer Personal Unit", "isCorrect": false }
      ]
    }
  ]
}
```

## CSV

Use these column headings. `correctAnswer` must be `A`, `B`, `C`, or `D`.

```csv
questionText,optionA,optionB,optionC,optionD,correctAnswer
What is a CPU?,Central Processing Unit,Computer Personal Unit,,,A
```

At least two options are required for every question, and exactly one option must be correct.

## Word

Use a `.docx` file with this pattern:

```text
Question 1: What is a CPU?
A. Central Processing Unit
B. Computer Personal Unit
Correct answer: A
```

Each question must begin with `Question 1:` (or another number), options must use `A.`, `B.`, `C.`, or `D.`, and the correct answer must be stated as `Correct answer: A`.

Imports are limited to 2 MB and are available to the instructor who owns the selected module.
