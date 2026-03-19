"""Analyze Damien's test data annotations."""
import pandas as pd

# Load the annotated test data
df = pd.read_csv(r'd:\upwork\Land_Parcel\test-data\Test data.csv')

print('=== KEY FINDINGS FROM DAMIEN TEST DATA ===')
print()

# 1. Damien's manual annotations
print('1. DAMIEN MANUAL ANNOTATIONS:')
for idx, row in df.iterrows():
    band = str(row['Acreage Band']).strip()
    if band not in ['micro', 'small', 'medium', 'large', 'nano', 'tract', 'nan']:
        print(f"   APN {row['APN']}: '{band}'")
print()

# 2. Pricing flags
print('2. PRICING FLAGS:')
print(df['Pricing Flag'].value_counts().to_string())
print()

# 3. Same comps issue - Leland getting same $304K
print('3. LELAND PARCELS ALL GETTING $304K (likely same 3 comps):')
leland = df[df['Retail Estimate'] == 304000]
for idx, row in leland.iterrows():
    print(f"   {row['APN']}: {row['Lot Acres']:.2f}ac, City={row['Parcel City']}, Comps={row['Clean Comp Count']}")
print()

# 4. SUSPECT_COMPS - retail much higher than TLP
print('4. SUSPECT_COMPS (retail >> TLP):')
suspect = df[df['Pricing Flag'] == 'SUSPECT_COMPS']
for idx, row in suspect.iterrows():
    ratio = row['Retail Estimate'] / row['TLP Estimate']
    print(f"   {row['APN']}: Retail=${row['Retail Estimate']:,}, TLP=${row['TLP Estimate']:,.0f}, Ratio={ratio:.1f}x")
print()

# 5. LOW_OFFER_VS_TLP - mid offer way below TLP
print('5. LOW_OFFER_VS_TLP (mid << TLP):')
low = df[df['Pricing Flag'] == 'LOW_OFFER_VS_TLP']
for idx, row in low.iterrows():
    ratio = row['Suggested Offer Mid'] / row['TLP Estimate'] * 100
    print(f"   {row['APN']}: Mid=${row['Suggested Offer Mid']:,}, TLP=${row['TLP Estimate']:,.0f}, Ratio={ratio:.1f}%")
print()

# Load comp data for deeper analysis
comps = pd.read_csv(r'd:\upwork\Land_Parcel\test-data\Brunswick Sold NEW TEST.csv', low_memory=False)
print('6. COMP DATA INSIGHTS:')
print(f'   Total comps: {len(comps)}')

# Check for recent sales that shouldn't be in data
comps['sale_date'] = pd.to_datetime(comps['Current Sale Recording Date'], format='mixed', errors='coerce')
recent = comps[comps['sale_date'] >= '2025-01-01']
print(f'   Comps from 2025+: {len(recent)}')

# Check for waterfront data
print(f'   Watercode filled: {comps["Watercode"].notna().sum()} / {len(comps)}')

# Check for duplicates
dup_apn = comps[comps['APN'].duplicated(keep=False)]
print(f'   Duplicate APNs: {len(dup_apn)} rows ({dup_apn["APN"].nunique()} unique APNs)')

