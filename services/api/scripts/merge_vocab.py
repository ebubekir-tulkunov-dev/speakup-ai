import csv
import json
import urllib.request
import ssl
import sys

ssl._create_default_https_context = ssl._create_unverified_context

def main():
    print("Starting vocabulary merge...")
    
    # 1. Fetch tyypgzl/Oxford-5000-words full-word.json for levels
    level_url = "https://raw.githubusercontent.com/tyypgzl/Oxford-5000-words/main/full-word.json"
    print(f"Downloading levels from: {level_url}")
    try:
        req = urllib.request.Request(level_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response:
            level_data = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Failed to download level JSON: {e}")
        sys.exit(1)
        
    print(f"Loaded {len(level_data)} level entries.")
    
    # Build word -> level mapping
    word_to_level = {}
    for item in level_data:
        val = item.get("value", {})
        word = val.get("word", "").strip().lower()
        level = val.get("level", "B1").strip().upper()
        if word:
            word_to_level[word] = level

    # 2. Fetch ciwga/Oxford3000_Vocab CSV for translations & examples
    csv_url = "https://raw.githubusercontent.com/ciwga/Oxford3000_Vocab/main/oxford3000_vocabulary_with_collocations_and_definitions_datasets.csv"
    print(f"Downloading translation CSV from: {csv_url}")
    try:
        req = urllib.request.Request(csv_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response:
            csv_lines = [line.decode("utf-8") for line in response.readlines()]
    except Exception as e:
        print(f"Failed to download translation CSV: {e}")
        sys.exit(1)

    print(f"Loaded {len(csv_lines)} CSV lines.")

    # Parse CSV lines
    reader = csv.reader(csv_lines)
    header = next(reader)
    # Header format: ['Word', 'Definition', 'Turkish Translation', 'Example Sentence', 'Part of Speech', ...]
    print("CSV Header:", header)

    merged_words = []
    missing_level_count = 0

    for i, row in enumerate(reader):
        if not row or len(row) < 4:
            continue
        
        lemma = row[0].strip().lower()
        translation_tr = row[2].strip()
        example = row[3].strip()
        
        if not lemma or not translation_tr:
            continue

        # Look up level
        level = word_to_level.get(lemma)
        if not level:
            # Try splitting multi-word terms or cleaning up
            clean_lemma = lemma.split()[0]
            level = word_to_level.get(clean_lemma, "B1")
            if clean_lemma not in word_to_level:
                missing_level_count += 1

        merged_words.append({
            "lemma": lemma,
            "translation_tr": translation_tr,
            "example": example if example else f"Example sentence with {lemma}.",
            "level": level,
            "source": "oxford3000"
        })

    print(f"Successfully merged {len(merged_words)} words.")
    print(f"Words with default level fallback: {missing_level_count}")

    # 3. Save to output JSON
    output_path = "../seed/oxford3000_tr.json"
    import os
    abs_output_path = os.path.join(os.path.dirname(__file__), output_path)
    with open(abs_output_path, "w", encoding="utf-8") as f:
        json.dump(merged_words, f, ensure_ascii=False, indent=2)
    
    print(f"Saved merged vocab database to: {abs_output_path}")

if __name__ == "__main__":
    main()
